/**
 * 📘 Algorithm Far Mail (AlFarMail)
 * - 매일 백준 문제를 랜덤 난이도로 메일 발송
 * - 웹페이지에서 구독 신청 가능
 */

const CONFIG = getConfig();
const OPENAI_API_KEY = CONFIG.OPENAI_API_KEY;
const SHEET_ID = CONFIG.SHEET_ID;
const SHEET_SENT = "SentProblems";
const SHEET_SUBS = "Subscribers";

const DIFFICULTY_LEVELS = ["브론즈", "실버", "골드"];
const MAX_RETRIES = 5;
const GPT_MODEL = "gpt-4o-mini";
const TEMPERATURE = 0.7;


function doGet() {
  return HtmlService.createHtmlOutputFromFile("index");
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const email = (data.email || "").trim();

    if (!email || !email.includes("@")) {
      return ContentService.createTextOutput("유효한 이메일을 입력해주세요.");
    }

    const sheetApp = SpreadsheetApp.openById(SHEET_ID);
    console.log(sheetApp)
    const sheet = sheetApp.getSheetByName(SHEET_SUBS)
    console.log(sheet)
    sheet.appendRow([email, new Date()]);

    return ContentService.createTextOutput("구독이 완료되었습니다!");
  } catch (err) {
    Logger.log(err);
    return ContentService.createTextOutput("서버 오류가 발생했습니다.");
  }
}

// ====================================================
// 메인 실행 함수 — 시트에서 수신자 불러와 메일 발송
// ====================================================
function sendGptProblemsToRecipients() {
  const subsSheet = getOrCreateSubscribersSheet();
  const data = subsSheet.getDataRange().getValues();
  const emails = data.slice(1).map(row => row[0]).filter(Boolean);
  const sentSheet = getOrCreateSentSheet();

  for (const email of emails) {
    const difficulty = getRandomDifficulty();
    Logger.log(`🎯 [START] ${email}에게 ${difficulty} 문제 전송 시작`);

    try {
      const problemData = fetchUniqueProblem(sentSheet, difficulty);
      console.log(problemData);
      if (!problemData) {
        Logger.log(`❌ ${email} - ${difficulty} 난이도 문제 가져오기 실패`);
        continue;
      }

      const problemId = extractProblemId(problemData["링크"]);
      sendProblemEmail(sentSheet, email, difficulty, problemData, problemId);
    } catch (error) {
      Logger.log(`🚨 ${email} 전송 중 오류: ${error.message}`);
    }
  }
}

// ====================================================
// 난이도 랜덤 선택
// ====================================================
function getRandomDifficulty() {
  return DIFFICULTY_LEVELS[Math.floor(Math.random() * DIFFICULTY_LEVELS.length)];
}

// ====================================================
// GPT를 통해 문제 가져오기
// ====================================================
function fetchUniqueProblem(sheet, difficulty) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const prompt = buildPrompt(difficulty);
    const response = requestGpt(prompt);

    const problemData = parseGptResponse(response);
    if (!problemData) {
      Logger.log(`⚠️ [${attempt}] JSON 파싱 실패, 재시도`);
      Utilities.sleep(1500);
      continue;
    }

    const problemId = extractProblemId(problemData["링크"]);
    if (!problemId) {
      Logger.log(`⚠️ [${attempt}] 문제 번호 인식 실패`);
      continue;
    }

    if (!isProblemAlreadySent(sheet, problemId, difficulty)) {
      return problemData;
    }

    Logger.log(`⚠️ [${attempt}] ${difficulty} - ${problemId} 중복 문제 감지, 재시도`);
    Utilities.sleep(1500);
  }

  return null;
}

/** 
 * ====================================================
 * GPT API 요청
 * ====================================================
 */
function requestGpt(prompt) {
  const payload = {
    model: GPT_MODEL,
    messages: [
      { role: "system", content: "너는 알고리즘 학습용 문제 생성 AI야." },
      { role: "user", content: prompt }
    ],
    temperature: TEMPERATURE
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", options);
  return JSON.parse(res.getContentText())?.choices?.[0]?.message?.content || "";
}

/** 
 * ====================================================
 * GPT 응답 파싱
 * ====================================================
 */
function parseGptResponse(content) {
  try { return JSON.parse(content); }
  catch { return null; }
}

/** 
 * ====================================================
 * 문제 링크에서 ID 추출
 * ====================================================
 */
function extractProblemId(link) {
  const match = link?.match(/problem\/(\d+)/);
  return match ? match[1] : null;
}

/** 
 * ====================================================
 * 시트 생성 / 로드
 * ====================================================
 */
function getOrCreateSentSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SENT);
  if (!sheet) sheet = ss.insertSheet(SHEET_SENT).appendRow(["날짜", "수신자", "난이도", "문제명", "문제번호", "링크"]);
  return ss.getSheetByName(SHEET_SENT);
}

function getOrCreateSubscribersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SUBS);
  if (!sheet) sheet = ss.insertSheet(SHEET_SUBS).appendRow(["이메일", "등록일"]);
  return ss.getSheetByName(SHEET_SUBS);
}

/** 
 * ====================================================
 * 중복 문제 검사
 * ====================================================
 */
function isProblemAlreadySent(sheet, problemId, difficulty) {
  const data = sheet.getDataRange().getValues();
  return data.some((row, idx) => idx > 0 && row[2] === difficulty && String(row[4]) === String(problemId));
}

/** 
 * ====================================================
 * 텍스트의 줄바꿈을 HTML <br>로 변환
 * ====================================================
 */
function formatTextForEmail(text) {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .trim();
}

function normalizeCode(code) {
  if (!code) return '';
  
  const lines = code.split('\n');
  
  // 빈 줄이 아닌 줄들의 앞 공백 개수 찾기
  const indents = lines
    .filter(line => line.trim().length > 0)  // 빈 줄 제외
    .map(line => {
      const match = line.match(/^(\s*)/);
      return match ? match[1].length : 0;
    });
  
  // 최소 들여쓰기 찾기
  const minIndent = Math.min(...indents);
  
  // 최소 들여쓰기만큼 모든 줄에서 제거
  const normalized = lines.map(line => {
    if (line.trim().length === 0) return '';  // 빈 줄은 그대로
    return line.substring(minIndent);
  }).join('\n');
  
  return normalized;
}

function formatCodeForEmail(code) {
  if (!code) return '';
  
  const normalizedCode = normalizeCode(code);

  // trim() 제거하고, 앞뒤 줄바꿈만 제거
  return normalizedCode
    .replace(/^\n+/, '')  // 맨 앞의 줄바꿈만 제거
    .replace(/\n+$/, '')  // 맨 뒤의 줄바꿈만 제거
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/ /g, '&nbsp;')
    .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
}

/** 
 * ====================================================
 * 메일 발송 및 시트 기록
 * ====================================================
 */
function sendProblemEmail(sheet, recipient, difficulty, problemData, problemId) {
  const { 문제명, 난이도, 문제유형, 링크, 접근방법, 자바코드, 주석해설, 풀이설명 } = problemData;
  const subject = `[AlFarMail] 오늘의 알고리즘 학습 📘 | ${문제명} (${난이도})`;
  
  // HTML 생성
  const htmlBody = generateEmailHtml(
    문제명,
    난이도,
    문제유형,
    링크,
    formatTextForEmail(접근방법),
    formatCodeForEmail(자바코드),
    formatTextForEmail(주석해설),
    formatTextForEmail(풀이설명)
  );

  // 메일 전송
  MailApp.sendEmail({
    to: recipient,
    subject,
    htmlBody
  });

  // 시트 기록
  sheet.appendRow([new Date(), recipient, difficulty, 문제명, problemId, 링크]);
}

/** 
 * ====================================================
 * 이메일 HTML 생성 함수
 * ====================================================
 */
function generateEmailHtml(problemName, level, problemType, link, approach, javaCode, comments, explanation) {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
    </style>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
                    
                    <!-- 헤더 -->
                    <tr>
                        <td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:40px 30px;text-align:center;">
                            <div style="font-size:48px;margin-bottom:10px;">📘</div>
                            <h1 style="margin:0;color:white;font-size:28px;font-weight:700;">AlFarMail</h1>
                            <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">알파메일(Algorithm Far Mail) - 멀리 가기 위한, 매일 알고리즘 메일</p>
                        </td>
                    </tr>

                    <!-- 본문 -->
                    <tr>
                        <td style="padding:40px 35px;">
                            
                            <!-- 문제 정보 카드 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%);border-radius:12px;margin-bottom:30px;">
                                <tr>
                                    <td style="padding:25px;">
                                        <h2 style="margin:0 0 15px;color:#1a237e;font-size:24px;font-weight:700;">${problemName}</h2>
                                        <div>
                                            <span style="display:inline-block;background:#667eea;color:white;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;margin-right:8px;">
                                                🏆 ${level}
                                            </span>
                                            <span style="display:inline-block;background:#764ba2;color:white;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;">
                                                📌 ${problemType}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            <!-- 문제 링크 버튼 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:40px;">
                                <tr>
                                    <td align="center">
                                        <a href="${link}" 
                                           style="display:inline-block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;text-decoration:none;padding:14px 35px;border-radius:30px;font-weight:700;font-size:16px;">
                                            🔗 문제 보러가기
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- 구분선 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin:35px 0;">
                                <tr>
                                    <td style="border-top:1px solid #e0e0e0;"></td>
                                </tr>
                            </table>

                            <!-- 접근 방법 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:35px;">
                                <tr>
                                    <td>
                                        <h3 style="color:#1a237e;font-size:20px;font-weight:700;margin:0 0 15px;">
                                            <span style="font-size:24px;margin-right:10px;">🧭</span>
                                            접근 방법
                                        </h3>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="background:#f8f9fa;padding:20px;border-radius:10px;border-left:4px solid #667eea;">
                                        <div style="font-family:'Courier New',monospace;font-size:14px;line-height:1.8;color:#333;">
                                            ${approach}
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            <!-- 자바 코드 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:35px;">
                                <tr>
                                    <td>
                                        <h3 style="color:#1a237e;font-size:20px;font-weight:700;margin:0 0 15px;">
                                            <span style="font-size:24px;margin-right:10px;">💻</span>
                                            Java 코드
                                        </h3>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="background:#1e1e1e;padding:20px;border-radius:10px;overflow-x:auto;"><div style="font-family:'Fira Code','Courier New',monospace;font-size:13px;line-height:1.7;color:#d4d4d4;white-space:pre;">${javaCode}</div></td>
                                </tr>
                            </table>

                            <!-- 코드 해설 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:35px;">
                                <tr>
                                    <td>
                                        <h3 style="color:#1a237e;font-size:20px;font-weight:700;margin:0 0 15px;">
                                            <span style="font-size:24px;margin-right:10px;">📝</span>
                                            코드 해설
                                        </h3>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="background:#fff8e1;padding:20px;border-radius:10px;border-left:4px solid #ffc107;">
                                        <div style="font-family:'Courier New',monospace;font-size:14px;line-height:1.8;color:#333;">
                                            ${comments}
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            <!-- 풀이 설명 -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:35px;">
                                <tr>
                                    <td>
                                        <h3 style="color:#1a237e;font-size:20px;font-weight:700;margin:0 0 15px;">
                                            <span style="font-size:24px;margin-right:10px;">🧠</span>
                                            풀이 설명
                                        </h3>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="background:#e8f5e9;padding:20px;border-radius:10px;border-left:4px solid #4caf50;">
                                        <div style="font-family:'Courier New',monospace;font-size:14px;line-height:1.8;color:#333;">
                                            ${explanation}
                                        </div>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- 푸터 -->
                    <tr>
                        <td style="background:#f5f7fa;padding:30px;text-align:center;border-top:1px solid #e0e0e0;">
                            <p style="margin:0 0 10px;color:#666;font-size:14px;">
                                매일 새로운 알고리즘 문제로 성장하세요! 💪
                            </p>
                            <p style="margin:0;color:#999;font-size:13px;">
                                AlFarMail | Algorithm Far Mail
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
  `;
}
