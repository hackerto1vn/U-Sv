/* =========================================================
   DB.JS - Firebase Firestore (dữ liệu dùng chung mọi máy)
   - Bộ sưu tập: "users" và "sos"
   - SOS được đồng bộ realtime qua onSnapshot và giữ trong bộ nhớ đệm
     => tự động cập nhật giữa các máy, đỡ tốn lượt đọc của Firestore
========================================================= */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCPJHGjl_jXMeXy5YeurIknI3zi1oJ9asg",
  authDomain: "sos-app-42d51.firebaseapp.com",
  projectId: "sos-app-42d51",
  storageBucket: "sos-app-42d51.firebasestorage.app",
  messagingSenderId: "594100462005",
  appId: "1:594100462005:web:6cc392af8a97c0082479fc",
  measurementId: "G-NBF22VP2ZB"
};
const FIREBASE_VERSION = "13.0.0";

let _fs = null;          // module firebase-firestore
let _db = null;          // instance Firestore
let _openPromise = null;
const _sosCache = new Map();
const _clone = (o) => JSON.parse(JSON.stringify(o));

function reportDbError(err) {
  console.error("Firestore:", err);
  if (document.getElementById("dbErrorBanner")) return;
  const el = document.createElement("div");
  el.id = "dbErrorBanner";
  el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc3545;color:#fff;" +
    "padding:10px 16px;font-size:14px;text-align:center";
  el.textContent = "⚠️ Không kết nối được cơ sở dữ liệu (" + ((err && (err.code || err.message)) || "lỗi") +
    "). Kiểm tra mạng và Rules của Firestore, rồi tải lại trang.";
  document.body.appendChild(el);
}

function openDB() {
  if (_openPromise) return _openPromise;
  _openPromise = (async () => {
    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
      const [appMod, fs] = await Promise.all([
        import(base + "firebase-app.js"),
        import(base + "firebase-firestore.js")
      ]);
      _fs = fs;
      _db = fs.getFirestore(appMod.initializeApp(FIREBASE_CONFIG));

      // Nghe realtime toàn bộ SOS
      await new Promise((resolve) => {
        let first = true;
        fs.onSnapshot(fs.collection(_db, "sos"), (snap) => {
          snap.docChanges().forEach(ch => {
            if (ch.type === "removed") _sosCache.delete(ch.doc.id);
            else _sosCache.set(ch.doc.id, ch.doc.data());
          });
          if (first) { first = false; resolve(); }
        }, (err) => {
          reportDbError(err);
          if (first) { first = false; resolve(); }
        });
      });
      return _db;
    } catch (e) {
      reportDbError(e);
      _db = null;
      return null;
    }
  })();
  return _openPromise;
}

async function _ready() {
  await openDB();
  if (!_db) throw new Error("Chưa kết nối được cơ sở dữ liệu");
}

/* ---------- USERS ---------- */
async function dbGetAllUsers() {
  try {
    await _ready();
    const snap = await _fs.getDocs(_fs.collection(_db, "users"));
    return snap.docs.map(d => d.data());
  } catch (e) { reportDbError(e); return []; }
}

async function _queryUsers(field, value) {
  await _ready();
  const q = _fs.query(_fs.collection(_db, "users"), _fs.where(field, "==", value));
  const snap = await _fs.getDocs(q);
  return snap.docs.map(d => d.data());
}

async function dbGetUserByUsername(username) {
  try { return (await _queryUsers("username", String(username).toLowerCase()))[0] || null; }
  catch (e) { reportDbError(e); return null; }
}

async function dbGetUserByPhone(phone) {
  try { return (await _queryUsers("phone", phone)).find(u => u.role === "victim") || null; }
  catch (e) { reportDbError(e); return null; }
}

async function dbGetUserById(id) {
  try {
    await _ready();
    const snap = await _fs.getDoc(_fs.doc(_db, "users", id));
    return snap.exists() ? snap.data() : null;
  } catch (e) { reportDbError(e); return null; }
}

async function dbAddUser(user) {
  await _ready();
  await _fs.setDoc(_fs.doc(_db, "users", user.id), _clone(user));
  return user;
}

async function dbUpdateUser(user) {
  await _ready();
  await _fs.setDoc(_fs.doc(_db, "users", user.id), _clone(user));
  return user;
}

async function dbDeleteUser(id) {
  await _ready();
  await _fs.deleteDoc(_fs.doc(_db, "users", id));
  return true;
}

/* ---------- SOS (đọc từ bộ nhớ đệm realtime) ---------- */
async function dbGetAllSOS() {
  await openDB();
  return [..._sosCache.values()].map(_clone);
}

async function dbGetSOSByUser(userId) {
  return (await dbGetAllSOS()).filter(s => s.userId === userId);
}

async function dbGetSOSById(id) {
  await openDB();
  const s = _sosCache.get(id);
  return s ? _clone(s) : null;
}

async function dbAddSOS(sos) {
  await _ready();
  const data = _clone(sos);
  await _fs.setDoc(_fs.doc(_db, "sos", sos.id), data);
  _sosCache.set(sos.id, data);
  return sos;
}

async function dbUpdateSOS(sos) {
  await _ready();
  const data = _clone(sos);
  await _fs.setDoc(_fs.doc(_db, "sos", sos.id), data);
  _sosCache.set(sos.id, data);
  return sos;
}

async function dbDeleteSOS(id) {
  await _ready();
  await _fs.deleteDoc(_fs.doc(_db, "sos", id));
  _sosCache.delete(id);
  return true;
}

/* Xóa tất cả SOS của 1 user */
async function dbDeleteSOSByUser(userId) {
  const list = await dbGetSOSByUser(userId);
  for (const s of list) await dbDeleteSOS(s.id);
  return list.length;
}

/* Xóa nhiều SOS (theo điều kiện) - trả về số bản ghi đã xóa */
async function dbDeleteSOSWhere(predicate) {
  const list = await dbGetAllSOS();
  let n = 0;
  for (const s of list) {
    if (!predicate || predicate(s)) { await dbDeleteSOS(s.id); n++; }
  }
  return n;
}

/* Xóa toàn bộ người dùng (trừ admin) + SOS của họ */
async function dbDeleteAllNonAdminUsers() {
  const users = (await dbGetAllUsers()).filter(u => u.role !== "admin");
  for (const u of users) {
    await dbDeleteSOSByUser(u.id);
    await dbDeleteUser(u.id);
  }
  return users.length;
}

/* ---------- SEED ADMIN ---------- */
async function seedAdmin() {
  await openDB();
  if (!_db) return;
  const existing = await dbGetUserByUsername("huykhanh");
  if (existing) {
    if (existing.role !== "admin") {
      existing.role = "admin";
      await dbUpdateUser(existing);
    }
    return;
  }
  await dbAddUser({
    id: "ADMIN-001",
    name: "Quản trị hệ thống",
    username: "huykhanh",
    phone: "—",
    password: "huykhanh",
    role: "admin",
    active: true,
    createdAt: new Date().toISOString()
  });
  console.log("✅ Admin tạo: huykhanh / huykhanh");
}
