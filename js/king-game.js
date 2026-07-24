/* ==========================================================
   king-game.js
   王様ゲーム本体ロジック(Firestoreでリアルタイム同期)
   ========================================================== */

/* ---------- Firebase 初期化 ---------- */
firebase.initializeApp(KING_GAME_FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

/* ---------- 命令テンプレート ----------
   slots: 文中に埋め込む番号の数(1 or 2)
   text : {A} {B} を実際の番号に置き換えて使う
----------------------------------------- */
const COMMAND_TEMPLATES = [
  { slots: 1, text: "{A}番の人が一発ギャグをする" },
  { slots: 2, text: "{A}番と{B}番が腕を組む" },
  { slots: 1, text: "{A}番の人がモノマネをする" },
  { slots: 2, text: "{A}番と{B}番が指切りげんまんする" },
  { slots: 1, text: "{A}番の人が好きなタイプを一言で言う" },
  { slots: 1, text: "{A}番の人がグラスを一気飲みする" },
  { slots: 2, text: "{A}番と{B}番でじゃんけん、負けた方が一発芸" },
  { slots: 1, text: "{A}番の人が今の気持ちを一言で表す" },
  { slots: 2, text: "{A}番が{B}番に本音を一つ伝える" },
  { slots: 1, text: "{A}番の人が10秒間変な顔をキープする" },
  { slots: 2, text: "{A}番と{B}番で背中合わせになる" },
  { slots: 1, text: "{A}番の人が特技を披露する" },
  { slots: 1, text: "{A}番の人が今日一番言いたかったことを言う" },
  { slots: 2, text: "{A}番が{B}番にお酌をする" },
  { slots: 1, text: "次のドリンクは{A}番の人のおごり" },
  { slots: 1, text: "{A}番の人が謎の高いテンションで挨拶する" }
];

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字(0/O/1/I)を除外

/* ---------- state ---------- */
const state = {
  uid: null,
  roomId: null,
  isHost: false,
  playerCount: 0,
  myNumber: null,
  isKing: false,
  unsubRoom: null,
  unsubPlayers: null,
  unsubMe: null
};

/* ---------- DOM ヘルパー ---------- */
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("is-active"));
  $(id).classList.add("is-active");
}

function setStatus(msg) {
  $("global-status").textContent = msg || "";
}

/* ---------- 認証 ---------- */
function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged((user) => {
      if (user) {
        state.uid = user.uid;
        resolve(user.uid);
      }
    });
    auth.signInAnonymously().catch(reject);
  });
}

/* ---------- ユーティリティ ---------- */
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickUniqueNumbers(count, max) {
  const pool = shuffle(Array.from({ length: max }, (_, i) => i + 1));
  return pool.slice(0, count);
}

/* ==========================================================
   画面1: ホーム(部屋を作る / 参加する)
   ========================================================== */
$("btn-create-room").addEventListener("click", async () => {
  const name = $("host-name").value.trim();
  if (!name) return showHomeError("名前を入力してください");
  $("btn-create-room").disabled = true;

  try {
    await ensureSignedIn();
    const roomId = generateRoomCode();

    await db.collection("rooms").doc(roomId).set({
      hostUid: state.uid,
      status: "waiting",
      kingUid: null,
      playerCount: 0,
      currentCommand: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection("rooms").doc(roomId).collection("players").doc(state.uid).set({
      name,
      number: null,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    state.roomId = roomId;
    state.isHost = true;
    sessionStorage.setItem("kg_roomId", roomId);
    sessionStorage.setItem("kg_isHost", "1");

    enterLobby();
  } catch (err) {
    console.error(err);
    showHomeError("部屋の作成に失敗しました。通信環境を確認してください。");
  } finally {
    $("btn-create-room").disabled = false;
  }
});

$("btn-join-room").addEventListener("click", async () => {
  const code = $("join-code").value.trim().toUpperCase();
  const name = $("join-name").value.trim();
  if (!code) return showHomeError("部屋コードを入力してください");
  if (!name) return showHomeError("名前を入力してください");
  $("btn-join-room").disabled = true;

  try {
    await ensureSignedIn();
    const roomRef = db.collection("rooms").doc(code);
    const roomSnap = await roomRef.get();

    if (!roomSnap.exists) {
      showHomeError("その部屋コードは見つかりませんでした");
      return;
    }
    if (roomSnap.data().status !== "waiting") {
      showHomeError("このゲームはすでに始まっています");
      return;
    }

    await roomRef.collection("players").doc(state.uid).set({
      name,
      number: null,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    state.roomId = code;
    state.isHost = roomSnap.data().hostUid === state.uid;
    sessionStorage.setItem("kg_roomId", code);
    sessionStorage.setItem("kg_isHost", state.isHost ? "1" : "0");

    enterLobby();
  } catch (err) {
    console.error(err);
    showHomeError("参加に失敗しました。部屋コードを確認してください。");
  } finally {
    $("btn-join-room").disabled = false;
  }
});

function showHomeError(msg) {
  $("home-error").textContent = msg;
}

/* ==========================================================
   画面2: 待合室
   ========================================================== */
function enterLobby() {
  showScreen("screen-lobby");
  $("lobby-room-code").textContent = state.roomId;
  $("lobby-host-controls").hidden = !state.isHost;
  $("lobby-guest-note").hidden = state.isHost;

  listenToRoom();
  listenToPlayers();
}

function listenToPlayers() {
  if (state.unsubPlayers) state.unsubPlayers();
  const playersRef = db.collection("rooms").doc(state.roomId).collection("players");

  state.unsubPlayers = playersRef.orderBy("joinedAt").onSnapshot((snap) => {
    const players = [];
    snap.forEach((doc) => players.push({ id: doc.id, ...doc.data() }));
    state.playerCount = players.length;

    $("lobby-count").textContent = `(${players.length})`;
    $("lobby-player-list").innerHTML = players
      .map((p) => `<li>${escapeHtml(p.name)}</li>`)
      .join("");

    if (state.isHost) {
      $("btn-start-draw").disabled = players.length < 3;
    }
  });
}

$("btn-start-draw").addEventListener("click", async () => {
  $("btn-start-draw").disabled = true;
  try {
    const playersRef = db.collection("rooms").doc(state.roomId).collection("players");
    const snap = await playersRef.get();
    const playerIds = [];
    snap.forEach((doc) => playerIds.push(doc.id));

    if (playerIds.length < 3) {
      $("btn-start-draw").disabled = false;
      return;
    }

    const shuffled = shuffle(playerIds);
    const kingUid = shuffled[Math.floor(Math.random() * shuffled.length)];

    const batch = db.batch();
    shuffled.forEach((uid, index) => {
      batch.update(playersRef.doc(uid), { number: index + 1 });
    });
    batch.update(db.collection("rooms").doc(state.roomId), {
      status: "drawn",
      kingUid,
      playerCount: shuffled.length,
      currentCommand: null
    });

    await batch.commit();
  } catch (err) {
    console.error(err);
    setStatus("くじ引きの開始に失敗しました");
    $("btn-start-draw").disabled = false;
  }
});

$("btn-copy-link").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${state.roomId}`;
  try {
    await navigator.clipboard.writeText(url);
    $("copy-feedback").textContent = "コピーしました!";
  } catch {
    $("copy-feedback").textContent = url;
  }
});

$("btn-close-room").addEventListener("click", closeRoom);
$("btn-close-room-2").addEventListener("click", closeRoom);

async function closeRoom() {
  if (!confirm("部屋を解散します。よろしいですか?")) return;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.delete(doc.ref));
    batch.delete(roomRef);
    await batch.commit();
  } catch (err) {
    console.error(err);
  }
  resetToHome();
}

function resetToHome() {
  cleanupListeners();
  sessionStorage.removeItem("kg_roomId");
  sessionStorage.removeItem("kg_isHost");
  state.roomId = null;
  state.isHost = false;
  showScreen("screen-home");
}

/* ==========================================================
   部屋全体の状態を監視して画面を切り替える
   ========================================================== */
function listenToRoom() {
  if (state.unsubRoom) state.unsubRoom();
  const roomRef = db.collection("rooms").doc(state.roomId);

  state.unsubRoom = roomRef.onSnapshot((doc) => {
    if (!doc.exists) {
      setStatus("部屋が解散されました");
      resetToHome();
      return;
    }
    const room = doc.data();
    state.isKing = room.kingUid === state.uid;
    state.playerCount = room.playerCount || state.playerCount;

    if (room.status === "waiting") {
      if (!$("screen-lobby").classList.contains("is-active")) {
        enterLobby();
      }
    } else if (room.status === "drawn") {
      enterDrawScreen(room);
    } else if (room.status === "command") {
      enterCommandScreen(room);
    }
  });
}

/* ==========================================================
   画面3: くじ引き結果 + 王様の命令フォーム
   ========================================================== */
function enterDrawScreen(room) {
  showScreen("screen-draw");
  $("draw-card").classList.remove("is-flipped");
  $("draw-king-badge").hidden = true;
  $("king-command-panel").hidden = true;
  $("draw-wait-note").hidden = false;

  if (state.unsubMe) state.unsubMe();
  const meRef = db.collection("rooms").doc(state.roomId).collection("players").doc(state.uid);

  state.unsubMe = meRef.onSnapshot((doc) => {
    const data = doc.data();
    if (!data || data.number == null) return;

    state.myNumber = data.number;
    $("draw-number").textContent = data.number;
    $("draw-card").classList.add("is-flipped");
    $("draw-wait-note").hidden = true;

    const amKing = room.kingUid === state.uid;
    $("draw-king-badge").hidden = !amKing;

    if (amKing) {
      setupKingPanel();
    }
  });
}

function setupKingPanel() {
  $("king-command-panel").hidden = false;

  const select = $("template-select");
  if (select.dataset.filled !== "1") {
    COMMAND_TEMPLATES.forEach((tpl, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = tpl.text.replace("{A}", "◯").replace("{B}", "△");
      select.appendChild(opt);
    });
    select.dataset.filled = "1";
  }

  select.onchange = () => applyTemplate();
  $("btn-reroll").onclick = () => applyTemplate(true);
}

let currentTemplateIndex = null;

function applyTemplate(reroll) {
  const select = $("template-select");
  if (select.value === "") {
    $("btn-reroll").hidden = true;
    return;
  }
  currentTemplateIndex = Number(select.value);
  const tpl = COMMAND_TEMPLATES[currentTemplateIndex];
  const nums = pickUniqueNumbers(tpl.slots, state.playerCount || 3);

  let text = tpl.text.replace("{A}", nums[0]);
  if (tpl.slots === 2) text = text.replace("{B}", nums[1]);

  $("command-text").value = text;
  $("btn-reroll").hidden = false;
}

$("btn-send-command").addEventListener("click", async () => {
  const text = $("command-text").value.trim();
  if (!text) return;
  $("btn-send-command").disabled = true;

  try {
    await db.collection("rooms").doc(state.roomId).update({
      status: "command",
      currentCommand: text
    });
  } catch (err) {
    console.error(err);
    setStatus("命令の発表に失敗しました");
  } finally {
    $("btn-send-command").disabled = false;
  }
});

/* ==========================================================
   画面4: 命令発表
   ========================================================== */
function enterCommandScreen(room) {
  showScreen("screen-command");
  $("command-display").textContent = room.currentCommand || "";
  $("command-my-number").textContent = state.myNumber != null ? state.myNumber : "?";
  $("command-host-controls").hidden = !state.isHost;
  $("command-guest-note").hidden = state.isHost;
}

$("btn-next-round").addEventListener("click", async () => {
  $("btn-next-round").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.update(doc.ref, { number: null }));
    batch.update(roomRef, { status: "waiting", kingUid: null, currentCommand: null });
    await batch.commit();
  } catch (err) {
    console.error(err);
    setStatus("次のラウンドの開始に失敗しました");
  } finally {
    $("btn-next-round").disabled = false;
  }
});

/* ---------- 後片付け ---------- */
function cleanupListeners() {
  if (state.unsubRoom) state.unsubRoom();
  if (state.unsubPlayers) state.unsubPlayers();
  if (state.unsubMe) state.unsubMe();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ==========================================================
   初期化: URLパラメータでの部屋コード引き継ぎ / 再接続
   ========================================================== */
(function init() {
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    $("join-code").value = roomFromUrl.toUpperCase();
  }

  const savedRoomId = sessionStorage.getItem("kg_roomId");
  if (savedRoomId) {
    ensureSignedIn().then(() => {
      state.roomId = savedRoomId;
      state.isHost = sessionStorage.getItem("kg_isHost") === "1";
      db.collection("rooms").doc(savedRoomId).get().then((doc) => {
        if (doc.exists) {
          enterLobby();
        } else {
          resetToHome();
        }
      });
    });
  }
})();
