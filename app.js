/* =========================================================
   APP.JS - Logic chính
========================================================= */
let currentUser = null;
let map = null;
let mapMarkers = [];
let syncInterval = null;
let currentSOSId = null;
let modalSnapshot = "";
let currentPageKey = "";
let lastPageSnapshot = "";
const SESSION_KEY = "sos_current_user_id";

/* ---------- KHỞI ĐỘNG ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  await openDB();
  await seedAdmin();
  updateClock();
  setInterval(updateClock, 1000);

  syncInterval = setInterval(autoSync, 3000);

  // Enter để đăng nhập
  ["userName", "userPhone"].forEach(id =>
    document.getElementById(id)?.addEventListener("keydown", e => { if (e.key === "Enter") doUserEnter(); }));
  ["adminUsername", "adminPassword"].forEach(id =>
    document.getElementById(id)?.addEventListener("keydown", e => { if (e.key === "Enter") doAdminLogin(); }));

  // Khôi phục phiên (giữ đăng nhập kể cả khi đóng trình duyệt)
  const savedId = localStorage.getItem(SESSION_KEY);
  if (savedId) {
    const fresh = await dbGetUserById(savedId);
    if (fresh && fresh.active !== false) {
      currentUser = fresh;
      showApp();
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }
});

function updateClock() {
  const el = document.getElementById("clockText");
  if (el) el.textContent = new Date().toLocaleString("vi-VN");
}

/* ---------- AUTO SYNC ---------- */
async function autoSync() {
  if (!currentUser) return;
  const page = currentPageKey;
  if (!page) return;

  const modalOpen = document.getElementById("sosModal")?.classList.contains("show");
  if (modalOpen) {
    // Người dân đang xem chi tiết: tự cập nhật tiến trình
    if (currentUser.role === "victim" && currentSOSId) {
      const cur = await dbGetSOSById(currentSOSId);
      const sig = cur ? JSON.stringify([cur.status, cur.response, cur.note, (cur.history || []).length]) : "gone";
      if (sig !== modalSnapshot) { modalSnapshot = sig; if (cur) await showSOS(currentSOSId); }
    }
    return;
  }

  if (["victimDashboard","mySOS","rescueDashboard","rescueRequests",
       "rescueHistory","adminDashboard","adminSOS"].includes(page)) {
    const data = await dbGetAllSOS();
    const snap = JSON.stringify(data.map(s => ({id:s.id, status:s.status, response:s.response, note:s.note, h:(s.history||[]).length})));
    if (snap !== lastPageSnapshot) {
      lastPageSnapshot = snap;
      await silentRefresh(page);
    }
  }
  if (map) refreshMapMarkers();
}

async function silentRefresh(page) {
  const content = document.getElementById("pageContent");
  if (!content) return;
  switch (page) {
    case "victimDashboard":  content.innerHTML = await renderVictimDashboard(); break;
    case "mySOS":            content.innerHTML = await renderMySOS(); break;
    case "rescueDashboard":  content.innerHTML = await renderRescueDashboard(); break;
    case "rescueRequests":   content.innerHTML = await renderRescueRequests(); break;
    case "rescueHistory":    content.innerHTML = await renderRescueHistory(); break;
    case "adminDashboard":   content.innerHTML = await renderAdminDashboard();
                             setTimeout(() => initMap("map"), 150); break;
    case "adminSOS":         content.innerHTML = await renderAdminSOS(); break;
  }
}

/* ---------- TIỆN ÍCH ĐĂNG NHẬP ---------- */
function showMsg(id, text, type = "danger") {
  document.getElementById(id).innerHTML =
    `<div class="alert alert-${type} py-2 mb-2"><i class="fas fa-info-circle"></i> ${text}</div>`;
}

function normalizePhone(p) { return String(p || "").replace(/[\s.\-()]/g, ""); }

function toggleAdminBox(e) {
  if (e) e.preventDefault();
  const box = document.getElementById("adminBox");
  const open = box.style.display === "none";
  box.style.display = open ? "block" : "none";
  document.getElementById("adminMessage").innerHTML = "";
  if (open) document.getElementById("adminUsername").focus();
}

function startSession(user) {
  currentUser = user;
  localStorage.setItem(SESSION_KEY, user.id);
  showApp();
}

/* ---------- NGƯỜI DÂN: vào bằng họ tên + SĐT (không cần đăng ký) ---------- */
async function doUserEnter() {
  const name = document.getElementById("userName").value.trim();
  const phone = normalizePhone(document.getElementById("userPhone").value);

  if (!name || !phone) { showMsg("userMessage", "Vui lòng nhập họ tên và số điện thoại"); return; }
  if (!/^\+?\d{8,15}$/.test(phone)) { showMsg("userMessage", "Số điện thoại không hợp lệ"); return; }

  // Cùng số điện thoại => cùng tài khoản => thấy lại toàn bộ SOS cũ
  let user = await dbGetUserByPhone(phone);

  if (!user) {
    let username = phone;
    if (await dbGetUserByUsername(username)) username = phone + "-" + Date.now();
    user = {
      id: "USER-" + Date.now(),
      name, username, phone,
      password: "",
      role: "victim",
      active: true,
      createdAt: new Date().toISOString()
    };
    await dbAddUser(user);
  }

  if (user.active === false) { showMsg("userMessage", "Tài khoản đã bị khóa"); return; }
  startSession(user);
}

/* ---------- QUẢN TRỊ VIÊN ---------- */
async function doAdminLogin() {
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value;

  if (!username || !password) { showMsg("adminMessage", "Nhập đủ thông tin"); return; }

  const user = await dbGetUserByUsername(username);
  if (!user || user.password !== password || !["admin", "rescue"].includes(user.role)) {
    showMsg("adminMessage", "Sai tài khoản hoặc mật khẩu");
    return;
  }
  if (user.active === false) { showMsg("adminMessage", "Tài khoản đã bị khóa"); return; }
  startSession(user);
}

/* ---------- LOGOUT ---------- */
function doLogout() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  currentSOSId = null;
  currentPageKey = "";
  lastPageSnapshot = "";
  if (map) { map.remove(); map = null; }
  mapMarkers = [];
  document.getElementById("appWrapper").style.display = "none";
  document.getElementById("loginPage").style.display = "flex";
  ["userName", "userPhone", "adminUsername", "adminPassword"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  document.getElementById("adminBox").style.display = "none";
  document.getElementById("userMessage").innerHTML = "";
  document.getElementById("adminMessage").innerHTML = "";
}

/* ---------- SHOW APP ---------- */
function showApp() {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("appWrapper").style.display = "block";
  document.getElementById("userNameDisplay").textContent = currentUser.name;
  document.getElementById("sidebarName").textContent = currentUser.name;
  document.getElementById("sidebarAvatar").textContent = currentUser.name.charAt(0).toUpperCase();

  const roleText = currentUser.role === "admin" ? "Quản trị viên"
    : currentUser.role === "rescue" ? "Trung tâm cứu hộ" : "Người dân";
  document.getElementById("sidebarRole").textContent = roleText;

  buildSidebar();

  if (currentUser.role === "victim") loadPage("victimDashboard");
  else if (currentUser.role === "rescue") loadPage("rescueDashboard");
  else if (currentUser.role === "admin") loadPage("adminDashboard");
}

/* ---------- SIDEBAR ---------- */
function buildSidebar() {
  const menu = document.getElementById("sidebarMenu");
  let html = "";

  if (currentUser.role === "victim") {
    html = `
      <li class="nav-item"><a class="nav-link active" onclick="loadPage('victimDashboard')"><i class="nav-icon fas fa-home"></i><p>Dashboard</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('createSOS')"><i class="nav-icon fas fa-exclamation-triangle text-danger"></i><p>Gửi SOS</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('mySOS')"><i class="nav-icon fas fa-history"></i><p>Lịch sử SOS</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="showProfile()"><i class="nav-icon fas fa-user-cog"></i><p>Tài khoản</p></a></li>`;
  } else if (currentUser.role === "rescue") {
    html = `
      <li class="nav-item"><a class="nav-link active" onclick="loadPage('rescueDashboard')"><i class="nav-icon fas fa-home"></i><p>Dashboard</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('rescueMap')"><i class="nav-icon fas fa-map-marked-alt"></i><p>Bản đồ cứu hộ</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('rescueRequests')"><i class="nav-icon fas fa-clipboard-list"></i><p>Yêu cầu SOS</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('rescueHistory')"><i class="nav-icon fas fa-history"></i><p>Lịch sử</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="showProfile()"><i class="nav-icon fas fa-user-cog"></i><p>Tài khoản</p></a></li>`;
  } else if (currentUser.role === "admin") {
    html = `
      <li class="nav-header text-uppercase small text-muted">QUẢN TRỊ</li>
      <li class="nav-item"><a class="nav-link active" onclick="loadPage('adminDashboard')"><i class="nav-icon fas fa-tachometer-alt"></i><p>Dashboard</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('adminSOS')"><i class="nav-icon fas fa-exclamation-triangle"></i><p>Quản lý SOS</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('adminSearch')"><i class="nav-icon fas fa-search text-warning"></i><p>Tra mã cứu hộ</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('rescueMap')"><i class="nav-icon fas fa-map-marked-alt"></i><p>Bản đồ tổng hợp</p></a></li>
      <li class="nav-item"><a class="nav-link" onclick="loadPage('adminUsers')"><i class="nav-icon fas fa-users"></i><p>Người dùng</p></a></li>`;
  }
  menu.innerHTML = html;
}

/* ---------- PAGE ROUTER ---------- */
async function loadPage(page) {
  currentPageKey = page;
  lastPageSnapshot = "";

  const content = document.getElementById("pageContent");
  const title = document.getElementById("pageTitle");
  const bc = document.getElementById("breadcrumb");

  document.querySelectorAll(".nav-sidebar .nav-link").forEach(l => l.classList.remove("active"));

  if (map) { map.remove(); map = null; mapMarkers = []; }

  switch (page) {
    case "victimDashboard":
      title.textContent = "Dashboard"; bc.textContent = "Dashboard";
      content.innerHTML = await renderVictimDashboard(); break;

    case "createSOS":
      title.textContent = "Gửi yêu cầu SOS"; bc.textContent = "Gửi SOS";
      content.innerHTML = renderCreateSOS();
      getLocation(); break;

    case "mySOS":
      title.textContent = "Lịch sử SOS"; bc.textContent = "Lịch sử SOS";
      content.innerHTML = await renderMySOS(); break;

    case "rescueDashboard":
      title.textContent = "Dashboard cứu hộ"; bc.textContent = "Dashboard";
      content.innerHTML = await renderRescueDashboard(); break;

    case "rescueMap":
      title.textContent = "Bản đồ cứu hộ"; bc.textContent = "Bản đồ";
      content.innerHTML = renderMapPage();
      setTimeout(() => initMap("map"), 250); break;

    case "rescueRequests":
      title.textContent = "Yêu cầu SOS"; bc.textContent = "Yêu cầu";
      content.innerHTML = await renderRescueRequests(); break;

    case "rescueHistory":
      title.textContent = "Lịch sử cứu hộ"; bc.textContent = "Lịch sử";
      content.innerHTML = await renderRescueHistory(); break;

    case "adminDashboard":
      if (currentUser.role !== "admin") return;
      title.textContent = "Quản trị hệ thống"; bc.textContent = "Dashboard";
      content.innerHTML = await renderAdminDashboard();
      setTimeout(() => initMap("map"), 200); break;

    case "adminUsers":
      if (currentUser.role !== "admin") return;
      title.textContent = "Quản lý người dùng"; bc.textContent = "Người dùng";
      content.innerHTML = await renderAdminUsers(); break;

    case "adminSOS":
      if (currentUser.role !== "admin") return;
      title.textContent = "Quản lý SOS"; bc.textContent = "SOS";
      content.innerHTML = await renderAdminSOS(); break;

    case "adminSearch":
      if (currentUser.role !== "admin") return;
      title.textContent = "Tra mã cứu hộ"; bc.textContent = "Tra mã";
      content.innerHTML = renderAdminSearch(); break;
  }

  const link = document.querySelector(`.nav-sidebar .nav-link[onclick*="'${page}'"]`);
  if (link) link.classList.add("active");
}

/* ---------- HELPERS ---------- */
function escapeHtml(t) {
  if (!t) return "";
  return String(t).replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function formatDate(d) { return d ? new Date(d).toLocaleString("vi-VN") : "—"; }

function statusBadge(s) {
  const map = {
    new:      { t: "Mới",          c: "danger"  },
    received: { t: "Đã tiếp nhận", c: "warning" },
    arriving: { t: "Đang đến",     c: "info"    },
    done:     { t: "Đã cứu hộ",    c: "success" }
  };
  const it = map[s] || map.new;
  return `<span class="badge badge-${it.c} status-badge">${it.t}</span>`;
}

/* ---------- TIẾN TRÌNH SOS ---------- */
const SOS_STEPS = [
  { key: "new",      label: "Đã gửi",       icon: "fa-paper-plane" },
  { key: "received", label: "Đã tiếp nhận", icon: "fa-hand-paper"  },
  { key: "arriving", label: "Đang đến",     icon: "fa-ambulance"   },
  { key: "done",     label: "Đã cứu hộ",    icon: "fa-check"       }
];

function sosStepIndex(status) {
  const i = SOS_STEPS.findIndex(s => s.key === status);
  return i < 0 ? 0 : i;
}

function sosStepTime(sos, key) {
  const hist = sos.history || [];
  const h = hist.filter(x => x.status === key).pop();
  if (h) return h.at;
  if (key === "new") return sos.createdAt;
  return null;
}

function progressPercent(status) {
  return Math.round((sosStepIndex(status) + 1) / SOS_STEPS.length * 100);
}

function progressStepper(sos) {
  const cur = sosStepIndex(sos.status);
  const finished = sos.status === "done";
  return `
    <div class="sos-steps">
      ${SOS_STEPS.map((st, i) => {
        const cls = i < cur ? "done" : i === cur ? "current" + (finished ? " is-done" : "") : "";
        const t = i <= cur ? sosStepTime(sos, st.key) : null;
        return `<div class="sos-step ${cls}">
          <div class="dot"><i class="fas ${i < cur || (i === cur && finished) ? "fa-check" : st.icon}"></i></div>
          <div class="lbl">${st.label}</div>
          <div class="tm">${t ? formatDate(t) : ""}</div>
        </div>`;
      }).join("")}
    </div>`;
}

function progressMiniBar(status) {
  const p = progressPercent(status);
  const color = status === "done" ? "bg-success" : status === "arriving" ? "bg-info"
              : status === "received" ? "bg-warning" : "bg-danger";
  return `<div class="progress sos-mini-bar"><div class="progress-bar ${color}" style="width:${p}%"></div></div>
          <small class="text-muted">${p}%</small>`;
}

function statCard(title, num, color, icon) {
  return `
    <div class="col-lg-3 col-md-6">
      <div class="small-box ${color} stat-card">
        <div class="inner"><h3>${num}</h3><p>${title}</p></div>
        <div class="icon"><i class="fas ${icon}"></i></div>
      </div>
    </div>`;
}

/* ---------- VICTIM DASHBOARD ---------- */
async function renderVictimDashboard() {
  const mine = await dbGetSOSByUser(currentUser.id);
  const active = mine.filter(s => s.status !== "done").length;
  const done = mine.filter(s => s.status === "done").length;

  return `
    <div class="row">
      ${statCard("Yêu cầu SOS", mine.length, "bg-danger", "fa-bell")}
      ${statCard("Đang xử lý", active, "bg-warning", "fa-spinner")}
      ${statCard("Đã cứu hộ", done, "bg-success", "fa-check")}
    </div>
    <div class="card">
      <div class="card-header bg-danger text-white">
        <h3 class="card-title"><i class="fas fa-exclamation-triangle"></i> Yêu cầu hỗ trợ khẩn cấp</h3>
      </div>
      <div class="card-body text-center py-5">
        <p class="lead">Gửi vị trí và tình trạng hiện tại để TT Cứu hộ tiếp nhận.</p>
        <button class="btn btn-sos px-5" onclick="loadPage('createSOS')">
          <i class="fas fa-bullhorn"></i> GỬI SOS NGAY
        </button>
      </div>
    </div>
    ${renderVictimProgress(mine)}`;
}

function renderVictimProgress(mine) {
  const list = mine.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
  if (!list.length) return "";
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title"><i class="fas fa-route text-primary"></i> Tiến trình yêu cầu SOS của bạn</h3>
        <div class="card-tools"><button class="btn btn-sm btn-light" onclick="loadPage('mySOS')">Xem tất cả</button></div>
      </div>
      <div class="card-body">
        ${list.map(s => `
          <div class="mb-4">
            <div class="d-flex justify-content-between flex-wrap">
              <b class="text-danger">${s.id}</b>
              <span>${statusBadge(s.status)} <small class="text-muted ml-2">${formatDate(s.datetime)}</small></span>
            </div>
            ${progressStepper(s)}
            ${s.response ? `<div class="alert alert-success py-2 mt-2 mb-0"><i class="fas fa-comment"></i> ${escapeHtml(s.response)}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

/* ---------- CREATE SOS ---------- */
function renderCreateSOS() {
  return `
    <div class="row"><div class="col-lg-8 mx-auto">
      <div class="card card-danger card-outline">
        <div class="card-header bg-danger text-white">
          <h3 class="card-title"><i class="fas fa-exclamation-triangle"></i> Thông tin khẩn cấp</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Mô tả tình trạng <span class="text-danger">*</span></label>
            <textarea id="sosDescription" class="form-control" rows="5"
              placeholder="Mô tả tình trạng, số người, nhu cầu..."></textarea>
          </div>
          <div class="form-group">
            <label>Vị trí GPS</label>
            <div class="input-group">
              <input id="sosLocation" class="form-control" placeholder="Đang lấy vị trí..." readonly>
              <div class="input-group-append">
                <button class="btn btn-primary" onclick="getLocation()">
                  <i class="fas fa-location-arrow"></i> GPS
                </button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>Ngày giờ</label>
            <input id="sosDate" type="datetime-local" class="form-control" value="${getDateTime()}">
          </div>
          <button class="btn btn-sos btn-block" onclick="sendSOS()">
            <i class="fas fa-broadcast-tower"></i> GỬI YÊU CẦU SOS
          </button>
        </div>
      </div>
    </div></div>`;
}

function getDateTime() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function getLocation() {
  if (!navigator.geolocation) { alert("Không hỗ trợ GPS."); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const input = document.getElementById("sosLocation");
      if (!input) return;
      input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      input.dataset.lat = lat; input.dataset.lng = lng;
    },
    () => alert("Không lấy được vị trí.")
  );
}

async function sendSOS() {
  const description = document.getElementById("sosDescription").value.trim();
  const locInput = document.getElementById("sosLocation");
  if (!description) { alert("Nhập mô tả."); return; }
  if (!locInput.value || !locInput.dataset.lat) { alert("Lấy GPS."); return; }

  const sos = {
    id: "SOS-" + Date.now(),
    userId: currentUser.id,
    userName: currentUser.name,
    description,
    location: locInput.value,
    lat: Number(locInput.dataset.lat),
    lng: Number(locInput.dataset.lng),
    datetime: document.getElementById("sosDate").value,
    status: "new",
    response: "", note: "", rescueUser: "",
    createdAt: new Date().toISOString()
  };
  sos.history = [{ status: "new", at: sos.createdAt, by: currentUser.name }];
  await dbAddSOS(sos);
  lastPageSnapshot = "";
  await loadPage("mySOS");
  showToast("✅ Gửi SOS thành công! Mã: " + sos.id);
}

/* ---------- MY SOS ---------- */
async function renderMySOS() {
  const list = (await dbGetSOSByUser(currentUser.id)).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  if (!list.length) return `<div class="card"><div class="card-body text-center p-5">
    <i class="fas fa-inbox fa-3x text-muted"></i><h4 class="mt-3">Chưa có yêu cầu SOS</h4></div></div>`;

  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title"><i class="fas fa-history"></i> Lịch sử SOS</h3></div>
      <div class="card-body table-responsive p-0">
        <table class="table table-hover text-nowrap">
          <thead>
            <tr>
              <th>Mã SOS</th>
              <th>Thời gian</th>
              <th>Trạng thái</th>
              <th style="width:150px">Tiến trình</th>
              <th>Phản hồi</th>
              <th style="width:200px">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(s => `
              <tr>
                <td><strong class="text-danger">${s.id}</strong></td>
                <td>${formatDate(s.datetime)}</td>
                <td>${statusBadge(s.status)}</td>
                <td>${progressMiniBar(s.status)}</td>
                <td>${s.response ? escapeHtml(s.response) : '<span class="text-muted">Chưa có</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="showSOS('${s.id}')" title="Xem chi tiết">
                    <i class="fas fa-eye"></i> Xem
                  </button>
                  ${s.status !== "done" ? `
                    <button class="btn btn-sm btn-outline-danger ml-1" onclick="cancelSOS('${s.id}')" title="Hủy yêu cầu">
                      <i class="fas fa-trash-alt"></i> Hủy
                    </button>
                  ` : `
                    <button class="btn btn-sm btn-outline-secondary ml-1" disabled title="Không thể hủy yêu cầu đã cứu hộ">
                      <i class="fas fa-lock"></i>
                    </button>
                  `}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ---------- CANCEL SOS (HỦY YÊU CẦU) ---------- */
async function cancelSOS(id) {
  if (currentUser.role !== "victim") return;

  const sos = await dbGetSOSById(id);
  if (!sos) { showToast("❌ Không tìm thấy yêu cầu!"); return; }

  if (sos.userId !== currentUser.id) {
    showToast("❌ Bạn không có quyền hủy yêu cầu này!");
    return;
  }

  if (sos.status === "done") {
    showToast("🔒 Không thể hủy yêu cầu đã cứu hộ!");
    return;
  }

  const ok = confirm(
    `⚠️ XÁC NHẬN HỦY YÊU CẦU SOS\n\n` +
    `Mã SOS: ${sos.id}\n` +
    `Thời gian: ${formatDate(sos.datetime)}\n` +
    `Mô tả: ${sos.description.substring(0, 60)}...\n\n` +
    `Bạn có chắc muốn HỦY yêu cầu này không?\n` +
    `Hành động này KHÔNG THỂ hoàn tác.`
  );
  if (!ok) return;

  await dbDeleteSOS(id);
  lastPageSnapshot = "";
  await loadPage("mySOS");
  showToast("🗑️ Đã hủy yêu cầu " + id);
}

/* ---------- RESCUE DASHBOARD ---------- */
async function renderRescueDashboard() {
  const list = await dbGetAllSOS();
  const newSOS = list.filter(s => s.status === "new").length;
  const arriving = list.filter(s => s.status === "arriving").length;
  const done = list.filter(s => s.status === "done").length;

  const recent = list.filter(s => s.status !== "done")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);

  return `
    <div class="row">
      ${statCard("Tổng SOS", list.length, "bg-danger", "fa-bell")}
      ${statCard("SOS mới", newSOS, "bg-warning", "fa-exclamation")}
      ${statCard("Đang đến", arriving, "bg-info", "fa-ambulance")}
      ${statCard("Đã cứu hộ", done, "bg-success", "fa-check")}
    </div>
    <div class="card">
      <div class="card-header">
        <h3 class="card-title"><i class="fas fa-exclamation-circle text-danger"></i> Yêu cầu SOS mới</h3>
        <div class="card-tools">
          <button class="btn btn-sm btn-primary" onclick="loadPage('rescueMap')">
            <i class="fas fa-map"></i> Bản đồ</button>
        </div>
      </div>
      <div class="card-body table-responsive p-0">${rescueTableHtml(recent)}</div>
    </div>`;
}

/* ---------- MAP ---------- */
function renderMapPage() {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title"><i class="fas fa-map-marked-alt"></i> Bản đồ cần cứu hộ</h3>
        <div class="card-tools">
          <button class="btn btn-sm btn-light" onclick="refreshMapMarkers()">
            <i class="fas fa-sync-alt"></i> Làm mới</button>
        </div>
      </div>
      <div class="card-body p-2"><div id="map" class="leaflet-map"></div></div>
    </div>`;
}

/* Nền bản đồ: Esri World Street Map (không cần API key).
   Nếu Esri lỗi thì tự chuyển sang OpenStreetMap. */
function addBaseLayer(m) {
  const primary = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors"
  }).addTo(m);

  let switched = false;
  primary.on("tileerror", () => {
    if (switched) return;
    switched = true;
    try {
      m.removeLayer(primary);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(m);
    } catch (e) {}
  });
}

/* ---------- BẢN ĐỒ NHỎ TRONG CHI TIẾT SOS ---------- */
let detailMap = null;

function destroyDetailMap() {
  if (detailMap) { detailMap.remove(); detailMap = null; }
}

function initDetailMap(sos) {
  const el = document.getElementById("sosDetailMap");
  if (!el || !sos.lat || !sos.lng) return;
  destroyDetailMap();

  detailMap = L.map(el).setView([sos.lat, sos.lng], 16);
  addBaseLayer(detailMap);

  const color = sos.status === "done" ? "#28a745"
    : sos.status === "arriving" ? "#17a2b8"
    : sos.status === "received" ? "#ffc107" : "#dc3545";
  L.circleMarker([sos.lat, sos.lng], {
    radius: 12, fillColor: color, color: "#fff", weight: 3, fillOpacity: .95
  }).addTo(detailMap).bindPopup(`<b>${escapeHtml(sos.userName)}</b><br>${escapeHtml(sos.location)}`);

  setTimeout(() => detailMap && detailMap.invalidateSize(), 150);
}

$(document).on("hidden.bs.modal", "#sosModal", destroyDetailMap);

async function initMap(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (map) { map.remove(); map = null; }
  mapMarkers = [];

  map = L.map(elementId).setView([16.0471, 108.2068], 6);
  addBaseLayer(map);

  await refreshMapMarkers();
  setTimeout(() => map.invalidateSize(), 200);
}

async function refreshMapMarkers() {
  if (!map) return;
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];

  let list = await dbGetAllSOS();
  if (currentUser.role === "victim") {
    list = list.filter(s => s.userId === currentUser.id);
  }

  list.forEach(s => {
    if (!s.lat || !s.lng) return;
    const color = s.status === "done" ? "#28a745"
      : s.status === "arriving" ? "#17a2b8"
      : s.status === "received" ? "#ffc107" : "#dc3545";

    const marker = L.circleMarker([s.lat, s.lng], {
      radius: 10, fillColor: color, color: "#fff", weight: 3, fillOpacity: .9
    }).addTo(map);

    marker.bindPopup(`
      <div style="min-width:220px">
        <strong style="color:#dc3545;font-size:15px">${s.id}</strong><br>
        <b>${escapeHtml(s.userName)}</b><br>
        <small>${escapeHtml(s.description.substring(0, 60))}...</small><br>
        ${statusBadge(s.status)}<br><br>
        <button class="btn btn-sm btn-danger" onclick="showSOS('${s.id}')">
          <i class="fas fa-eye"></i> Xem chi tiết</button>
      </div>
    `);
    mapMarkers.push(marker);
  });

  if (mapMarkers.length > 0) {
    try {
      const group = L.featureGroup(mapMarkers);
      map.fitBounds(group.getBounds().pad(0.2));
    } catch (e) {}
  }
}

/* ---------- RESCUE REQUESTS/HISTORY ---------- */
async function renderRescueRequests() {
  const list = (await dbGetAllSOS()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title"><i class="fas fa-clipboard-list"></i> Danh sách yêu cầu SOS</h3></div>
      <div class="card-body table-responsive p-0">${rescueTableHtml(list)}</div>
    </div>`;
}

async function renderRescueHistory() {
  const list = (await dbGetAllSOS()).filter(s => s.status === "done")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title"><i class="fas fa-history"></i> Lịch sử cứu hộ</h3></div>
      <div class="card-body table-responsive p-0">${rescueTableHtml(list)}</div>
    </div>`;
}

function rescueTableHtml(list) {
  if (!list.length) return `<div class="text-center text-muted p-5">Không có dữ liệu.</div>`;
  return `
    <table class="table table-hover">
      <thead><tr><th>Mã SOS</th><th>Người gửi</th><th>Mô tả</th><th>Thời gian</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>
        ${list.map(s => `
          <tr>
            <td><strong class="text-danger">${s.id}</strong></td>
            <td>${escapeHtml(s.userName)}</td>
            <td>${escapeHtml((s.description || "").substring(0, 50))}...</td>
            <td>${formatDate(s.datetime)}</td>
            <td>${statusBadge(s.status)}</td>
            <td class="text-nowrap">
              <button class="btn btn-sm btn-primary" onclick="showSOS('${s.id}')" title="Xem">
                <i class="fas fa-eye"></i></button>
              ${currentUser && currentUser.role === "admin" ? `
              <button class="btn btn-sm btn-outline-danger ml-1" onclick="adminDeleteSOS('${s.id}')" title="Xóa SOS">
                <i class="fas fa-trash"></i></button>` : ""}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

/* ---------- ADMIN DASHBOARD ---------- */
async function renderAdminDashboard() {
  const users = await dbGetAllUsers();
  const sos = await dbGetAllSOS();

  const victims = users.filter(u => u.role === "victim").length;
  const newSOS = sos.filter(s => s.status === "new").length;
  const processing = sos.filter(s => ["received", "arriving"].includes(s.status)).length;
  const completed = sos.filter(s => s.status === "done").length;

  return `
    <div class="row">
      ${statCard("SOS mới", newSOS, "bg-warning", "fa-bell")}
      ${statCard("Người bị nạn", victims, "bg-danger", "fa-user")}
      ${statCard("Đang xử lý", processing, "bg-info", "fa-spinner")}
      ${statCard("Đã cứu hộ", completed, "bg-success", "fa-check-circle")}
    </div>
    <div class="row">
      <div class="col-md-8">
        <div class="card">
          <div class="card-header"><h3 class="card-title"><i class="fas fa-map-marked-alt text-danger"></i> Bản đồ tổng hợp SOS</h3>
            <div class="card-tools"><button class="btn btn-sm btn-light" onclick="refreshMapMarkers()"><i class="fas fa-sync-alt"></i></button></div>
          </div>
          <div class="card-body p-2"><div id="map" class="leaflet-map" style="height:400px"></div></div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card">
          <div class="card-header"><h3 class="card-title"><i class="fas fa-chart-pie text-primary"></i> Tổng quan</h3></div>
          <div class="card-body">
            <ul class="list-group list-group-flush">
              <li class="list-group-item d-flex justify-content-between"><span>Tổng SOS</span><b>${sos.length}</b></li>
              <li class="list-group-item d-flex justify-content-between"><span>SOS mới</span><b class="text-danger">${newSOS}</b></li>
              <li class="list-group-item d-flex justify-content-between"><span>Đang xử lý</span><b class="text-warning">${processing}</b></li>
              <li class="list-group-item d-flex justify-content-between"><span>Đã cứu hộ</span><b class="text-success">${completed}</b></li>
            </ul>
            <button class="btn btn-primary btn-block mt-3" onclick="loadPage('adminSOS')">
              <i class="fas fa-list"></i> Xem tất cả SOS</button>
            <button class="btn btn-warning btn-block mt-2" onclick="loadPage('adminSearch')">
              <i class="fas fa-search"></i> Tra mã cứu hộ</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------- ADMIN USERS ---------- */
async function renderAdminUsers() {
  const list = (await dbGetAllUsers()).filter(u => u.role !== "admin");
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title"><i class="fas fa-users"></i> Danh sách người dùng</h3>
        <div class="card-tools">
          <button class="btn btn-sm btn-danger" onclick="adminDeleteAllUsers()"><i class="fas fa-trash"></i> Xóa tất cả người dùng</button>
        </div>
      </div>
      <div class="card-body table-responsive p-0">
        ${list.length ? `
        <table class="table table-hover">
          <thead>
            <tr>
              <th>Họ tên</th>
              <th>Tài khoản</th>
              <th>SĐT</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th style="width:200px">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(u => `
              <tr>
                <td>${escapeHtml(u.name)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.phone || "—")}</td>
                <td>${u.role === "victim"
                  ? '<span class="badge badge-danger">Người dân</span>'
                  : '<span class="badge badge-info">TT Cứu hộ</span>'}</td>
                <td>${u.active === false
                  ? '<span class="badge badge-secondary">Đã khóa</span>'
                  : '<span class="badge badge-success">Hoạt động</span>'}</td>
                <td>
                  <button class="btn btn-sm ${u.active === false ? "btn-success" : "btn-warning"}"
                    onclick="toggleUser('${u.id}')">
                    <i class="fas ${u.active === false ? "fa-unlock" : "fa-lock"}"></i>
                    ${u.active === false ? "Mở" : "Khóa"}
                  </button>
                  <button class="btn btn-sm btn-outline-danger ml-1" onclick="adminDeleteUser('${u.id}')">
                    <i class="fas fa-trash"></i> Xóa
                  </button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>` : '<div class="text-center text-muted p-5">Chưa có người dùng.</div>'}
      </div>
    </div>`;
}

async function toggleUser(id) {
  if (currentUser.role !== "admin") return;
  const u = await dbGetUserById(id);
  if (!u) return;
  u.active = u.active === false ? true : false;
  await dbUpdateUser(u);
  await loadPage("adminUsers");
  showToast(u.active ? "🔓 Đã mở khóa tài khoản" : "🔒 Đã khóa tài khoản");
}

async function adminDeleteUser(id) {
  if (currentUser.role !== "admin") return;
  const u = await dbGetUserById(id);
  if (!u) { showToast("❌ Không tìm thấy tài khoản!"); return; }
  if (u.role === "admin") { showToast("❌ Không thể xóa tài khoản admin!"); return; }

  const sosCount = (await dbGetSOSByUser(id)).length;
  const msg = `⚠️ XÁC NHẬN XÓA TÀI KHOẢN\n\n` +
              `Họ tên: ${u.name}\n` +
              `Tài khoản: ${u.username}\n` +
              `Vai trò: ${u.role === "victim" ? "Người dân" : "TT Cứu hộ"}\n` +
              `Số SOS đã gửi: ${sosCount}\n\n` +
              `Xóa tài khoản sẽ XÓA LUÔN tất cả SOS liên quan.\n` +
              `Hành động này KHÔNG THỂ hoàn tác!\n\n` +
              `Bạn có chắc chắn?`;

  if (!confirm(msg)) return;

  // Xóa hết SOS của user đó
  await dbDeleteSOSByUser(id);
  // Xóa user
  await dbDeleteUser(id);

  lastPageSnapshot = "";
  await loadPage("adminUsers");
  showToast(`🗑️ Đã xóa tài khoản: ${u.name}`);
}

/* ---------- ADMIN SOS ---------- */
async function renderAdminSOS() {
  const list = (await dbGetAllSOS()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title"><i class="fas fa-exclamation-triangle text-danger"></i> Tất cả yêu cầu SOS</h3>
        <div class="card-tools">
          <button class="btn btn-sm btn-warning" onclick="loadPage('adminSearch')"><i class="fas fa-search"></i> Tra mã</button>
          <button class="btn btn-sm btn-outline-danger ml-1" onclick="adminDeleteDoneSOS()"><i class="fas fa-broom"></i> Xóa SOS đã cứu hộ</button>
          <button class="btn btn-sm btn-danger ml-1" onclick="adminDeleteAllSOS()"><i class="fas fa-trash"></i> Xóa tất cả SOS</button>
        </div>
      </div>
      <div class="card-body table-responsive p-0">${rescueTableHtml(list)}</div>
    </div>`;
}

/* ---------- ADMIN: XÓA DỮ LIỆU ---------- */
async function adminDeleteSOS(id) {
  if (!currentUser || currentUser.role !== "admin") return;
  const sos = await dbGetSOSById(id);
  if (!sos) { showToast("❌ Không tìm thấy SOS!"); return; }
  if (!confirm(`Xóa SOS ${sos.id} của ${sos.userName}?\nKhông thể hoàn tác.`)) return;
  await dbDeleteSOS(id);
  $("#sosModal").modal("hide");
  lastPageSnapshot = "";
  await loadPage(currentPageKey);
  showToast("🗑️ Đã xóa " + id);
}

async function adminDeleteDoneSOS() {
  if (!currentUser || currentUser.role !== "admin") return;
  const n = (await dbGetAllSOS()).filter(s => s.status === "done").length;
  if (!n) { showToast("Không có SOS đã cứu hộ nào."); return; }
  if (!confirm(`Xóa ${n} SOS đã cứu hộ?\nKhông thể hoàn tác.`)) return;
  await dbDeleteSOSWhere(s => s.status === "done");
  lastPageSnapshot = "";
  await loadPage("adminSOS");
  showToast(`🗑️ Đã xóa ${n} SOS đã cứu hộ`);
}

async function adminDeleteAllSOS() {
  if (!currentUser || currentUser.role !== "admin") return;
  const n = (await dbGetAllSOS()).length;
  if (!n) { showToast("Chưa có SOS nào."); return; }
  if (!confirm(`⚠️ Xóa TẤT CẢ ${n} yêu cầu SOS?\nKhông thể hoàn tác.`)) return;
  await dbDeleteSOSWhere();
  lastPageSnapshot = "";
  await loadPage("adminSOS");
  showToast(`🗑️ Đã xóa ${n} SOS`);
}

async function adminDeleteAllUsers() {
  if (!currentUser || currentUser.role !== "admin") return;
  const n = (await dbGetAllUsers()).filter(u => u.role !== "admin").length;
  if (!n) { showToast("Chưa có người dùng nào."); return; }
  if (!confirm(`⚠️ Xóa TẤT CẢ ${n} người dùng và toàn bộ SOS của họ?\nKhông thể hoàn tác.`)) return;
  await dbDeleteAllNonAdminUsers();
  lastPageSnapshot = "";
  await loadPage("adminUsers");
  showToast(`🗑️ Đã xóa ${n} người dùng`);
}

/* ---------- ADMIN SEARCH ---------- */
function renderAdminSearch() {
  return `
    <div class="row">
      <div class="col-lg-8 mx-auto">
        <div class="card card-warning card-outline">
          <div class="card-header bg-warning">
            <h3 class="card-title text-white"><i class="fas fa-search"></i> Tra cứu mã cứu hộ</h3>
          </div>
          <div class="card-body">
            <div class="form-group">
              <label><b>Nhập mã SOS cần tra cứu</b></label>
              <div class="input-group input-group-lg">
                <input type="text" id="searchSOSCode" class="form-control"
                  placeholder="VD: SOS-1234567890" autocomplete="off">
                <div class="input-group-append">
                  <button class="btn btn-warning" onclick="doSearchSOS()">
                    <i class="fas fa-search"></i> Tra mã</button>
                </div>
              </div>
              <small class="text-muted">Nhập chính xác mã SOS (VD: SOS-1234567890) hoặc 1 phần của mã.</small>
            </div>
            <div id="searchResult"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title"><i class="fas fa-list"></i> Gợi ý mã SOS gần đây</h3></div>
          <div class="card-body table-responsive p-0" id="recentCodes"></div>
        </div>
      </div>
    </div>`;
}

async function doSearchSOS() {
  const keyword = document.getElementById("searchSOSCode").value.trim().toLowerCase();
  const box = document.getElementById("searchResult");

  if (!keyword) {
    box.innerHTML = `<div class="alert alert-warning">Vui lòng nhập mã SOS.</div>`;
    return;
  }

  const all = await dbGetAllSOS();
  const found = all.filter(s =>
    s.id.toLowerCase().includes(keyword) ||
    (s.userName || "").toLowerCase().includes(keyword) ||
    (s.location || "").toLowerCase().includes(keyword)
  );

  if (!found.length) {
    box.innerHTML = `<div class="alert alert-danger">
      <i class="fas fa-times-circle"></i> Không tìm thấy mã SOS nào khớp với "<b>${escapeHtml(keyword)}</b>".
    </div>`;
    return;
  }

  box.innerHTML = `
    <div class="alert alert-success">
      <i class="fas fa-check-circle"></i> Tìm thấy <b>${found.length}</b> kết quả.
    </div>
    ${found.map(s => `
      <div class="card ${statusClassCard(s.status)} mb-2">
        <div class="card-body py-2">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <h5 class="mb-1 text-danger"><b>${s.id}</b></h5>
              <p class="mb-1"><i class="fas fa-user"></i> <b>${escapeHtml(s.userName)}</b>
                 &nbsp;|&nbsp; <i class="fas fa-clock"></i> ${formatDate(s.datetime)}</p>
              <p class="mb-0 text-muted small">${escapeHtml((s.description || "").substring(0, 80))}...</p>
            </div>
            <div class="text-right">
              ${statusBadge(s.status)}<br>
              <button class="btn btn-sm btn-primary mt-2" onclick="showSOS('${s.id}')">
                <i class="fas fa-eye"></i> Chi tiết</button>
            </div>
          </div>
        </div>
      </div>`).join("")}`;
}

function statusClassCard(s) {
  return s === "done" ? "sos-done"
    : s === "arriving" ? "sos-arriving"
    : s === "received" ? "sos-received" : "sos-new";
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("[onclick*='adminSearch']")) {
    setTimeout(async () => {
      const box = document.getElementById("recentCodes");
      if (!box) return;
      const list = (await dbGetAllSOS())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10);
      if (!list.length) {
        box.innerHTML = '<div class="text-center text-muted p-4">Chưa có SOS nào.</div>';
        return;
      }
      box.innerHTML = `
        <table class="table table-sm table-hover mb-0">
          <thead><tr><th>Mã SOS</th><th>Người gửi</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            ${list.map(s => `
              <tr>
                <td><b class="text-danger">${s.id}</b></td>
                <td>${escapeHtml(s.userName)}</td>
                <td>${statusBadge(s.status)}</td>
                <td><button class="btn btn-xs btn-outline-primary" onclick="quickFill('${s.id}')">
                  <i class="fas fa-arrow-right"></i></button></td>
              </tr>`).join("")}
          </tbody>
        </table>`;
    }, 100);
  }
});

function quickFill(code) {
  document.getElementById("searchSOSCode").value = code;
  doSearchSOS();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- SHOW SOS DETAIL ---------- */
async function showSOS(id) {
  const sos = await dbGetSOSById(id);
  if (!sos) return;

  currentSOSId = id;
  modalSnapshot = JSON.stringify([sos.status, sos.response, sos.note, (sos.history || []).length]);
  const canEdit = ["rescue", "admin"].includes(currentUser.role) && sos.status !== "done";
  const canCancel = currentUser.role === "victim"
                  && sos.userId === currentUser.id
                  && sos.status !== "done";

  document.getElementById("sosModalBody").innerHTML = `
    <div class="row">
      <div class="col-md-6">
        <p><strong>Mã SOS:</strong> <span class="text-danger">${sos.id}</span></p>
        <p><strong>Người gửi:</strong> ${escapeHtml(sos.userName)}</p>
        <p><strong>Thời gian:</strong> ${formatDate(sos.datetime)}</p>
      </div>
      <div class="col-md-6">
        <p><strong>Vị trí:</strong> ${escapeHtml(sos.location)}</p>
        <p><strong>Trạng thái:</strong> <span id="modalStatus">${statusBadge(sos.status)}</span></p>
        <p><strong>TT Cứu hộ:</strong> ${sos.rescueUser || "Chưa tiếp nhận"}</p>
      </div>
    </div>
    <hr>
    <h6 class="text-muted mb-1"><i class="fas fa-route"></i> Tiến trình xử lý</h6>
    ${progressStepper(sos)}
    <hr>
    <div class="alert alert-danger">
      <strong><i class="fas fa-exclamation-circle"></i> Mô tả tình trạng</strong>
      <p class="mb-0 mt-2">${escapeHtml(sos.description)}</p>
    </div>

    ${sos.lat && sos.lng ? `
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <strong><i class="fas fa-map-marker-alt text-danger"></i> Vị trí trên bản đồ</strong>
          <a class="small" target="_blank" rel="noopener"
             href="https://www.google.com/maps?q=${sos.lat},${sos.lng}">
            <i class="fas fa-external-link-alt"></i> Mở Google Maps</a>
        </div>
        <div id="sosDetailMap" style="height:260px;border-radius:12px;overflow:hidden"></div>
      </div>` : ""}

    ${canEdit ? `
      <hr>
      <h5><i class="fas fa-tools"></i> Xử lý yêu cầu</h5>
      <div class="form-group">
        <label><i class="fas fa-comment-dots text-primary"></i> Phản hồi cho người bị nạn</label>
        <textarea id="responseText" class="form-control" rows="3"
          placeholder="VD: Đội cứu hộ đã xuất phát, dự kiến 15 phút...">${sos.response || ""}</textarea>
      </div>
      <div class="form-group">
        <label><i class="fas fa-sticky-note text-warning"></i> Ghi chú phương án cứu hộ</label>
        <textarea id="noteText" class="form-control" rows="3"
          placeholder="VD: Đã điều 2 xe cứu thương, 5 nhân viên...">${sos.note || ""}</textarea>
      </div>

      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap">
        <button class="btn btn-primary" onclick="saveSOSChanges('${sos.id}')">
          <i class="fas fa-save"></i> Lưu thay đổi
        </button>
        <small class="text-muted mt-2 mt-sm-0">
          <i class="fas fa-info-circle"></i> Lưu phản hồi / ghi chú mà không đổi trạng thái
        </small>
      </div>

      <hr>
      <h6 class="text-muted mb-2"><i class="fas fa-exchange-alt"></i> Hoặc cập nhật trạng thái:</h6>
      <div class="row">
        <div class="col-md-4 mb-2"><button class="btn btn-warning btn-block" onclick="updateSOS('${sos.id}','received')">
          <i class="fas fa-hand-paper"></i> Đã tiếp nhận</button></div>
        <div class="col-md-4 mb-2"><button class="btn btn-info btn-block" onclick="updateSOS('${sos.id}','arriving')">
          <i class="fas fa-ambulance"></i> Đang đến</button></div>
        <div class="col-md-4 mb-2"><button class="btn btn-success btn-block" onclick="updateSOS('${sos.id}','done')">
          <i class="fas fa-check"></i> Đã cứu hộ</button></div>
      </div>
    ` : `
      ${sos.response ? `<div class="alert alert-success">
        <strong><i class="fas fa-comment"></i> Phản hồi cứu hộ</strong>
        <p class="mb-0 mt-2">${escapeHtml(sos.response)}</p></div>` : ""}
      ${sos.note ? `<div class="alert alert-info">
        <strong>Ghi chú cứu hộ</strong>
        <p class="mb-0 mt-2">${escapeHtml(sos.note)}</p></div>` : ""}
    `}

    ${canCancel ? `
      <hr>
      <div class="d-flex justify-content-end">
        <button class="btn btn-outline-danger" onclick="cancelSOSFromModal('${sos.id}')">
          <i class="fas fa-trash-alt"></i> Hủy yêu cầu SOS này
        </button>
      </div>
    ` : ""}

    ${currentUser.role === "admin" ? `
      <hr>
      <div class="d-flex justify-content-end">
        <button class="btn btn-outline-danger" onclick="adminDeleteSOS('${sos.id}')">
          <i class="fas fa-trash"></i> Xóa SOS này
        </button>
      </div>
    ` : ""}

    ${currentUser.role === "victim" && sos.status === "done" ? `
      <hr>
      <div class="alert alert-secondary mb-0">
        <i class="fas fa-lock"></i> Yêu cầu đã cứu hộ thành công — không thể hủy.
      </div>
    ` : ""}
  `;

  destroyDetailMap();
  if ($("#sosModal").hasClass("show")) {
    setTimeout(() => initDetailMap(sos), 50);
  } else {
    $("#sosModal").one("shown.bs.modal", () => initDetailMap(sos));
    $("#sosModal").modal("show");
  }
}

async function cancelSOSFromModal(id) {
  $("#sosModal").modal("hide");
  setTimeout(() => cancelSOS(id), 300);
}

async function saveSOSChanges(id) {
  if (!["rescue", "admin"].includes(currentUser.role)) return;
  const sos = await dbGetSOSById(id);
  if (!sos) return;

  const response = document.getElementById("responseText");
  const note = document.getElementById("noteText");

  sos.response = response ? response.value.trim() : sos.response;
  sos.note = note ? note.value.trim() : sos.note;
  sos.updatedAt = new Date().toISOString();
  if (!sos.rescueUser) sos.rescueUser = currentUser.name;

  await dbUpdateSOS(sos);
  showToast("💾 Đã lưu thay đổi!");
  lastPageSnapshot = "";
  if (currentPageKey) await silentRefresh(currentPageKey);
}

async function updateSOS(id, status) {
  if (!["rescue", "admin"].includes(currentUser.role)) return;
  const sos = await dbGetSOSById(id);
  if (!sos) return;

  const response = document.getElementById("responseText");
  const note = document.getElementById("noteText");
  if (response && response.value.trim()) sos.response = response.value.trim();
  if (note && note.value.trim()) sos.note = note.value.trim();
  const now = new Date().toISOString();
  if (sos.status !== status) {
    sos.history = sos.history || [{ status: "new", at: sos.createdAt }];
    sos.history.push({ status, at: now, by: currentUser.name });
  }
  sos.status = status;
  sos.rescueUser = currentUser.name;
  sos.updatedAt = now;

  await dbUpdateSOS(sos);
  $("#sosModal").modal("hide");
  lastPageSnapshot = "";
  await silentRefresh(currentPageKey);

  const statusText = status === "received" ? "Đã tiếp nhận"
    : status === "arriving" ? "Đang đến" : "Đã cứu hộ";
  showToast("✅ Cập nhật: " + statusText);
}

/* ---------- PROFILE (thông tin cá nhân + xóa tài khoản) ---------- */
async function showProfile() {
  if (!currentUser) return;

  const roleText = currentUser.role === "admin" ? "Quản trị viên"
    : currentUser.role === "rescue" ? "Trung tâm cứu hộ" : "Người dân";

  const sosCount = currentUser.role === "victim"
    ? (await dbGetSOSByUser(currentUser.id)).length : 0;

  document.getElementById("profileModalBody").innerHTML = `
    <div class="text-center mb-3">
      <div class="avatar-circle mx-auto" style="width:72px;height:72px;font-size:28px;">
        ${currentUser.name.charAt(0).toUpperCase()}
      </div>
      <h5 class="mt-3 mb-1"><b>${escapeHtml(currentUser.name)}</b></h5>
      <span class="badge badge-primary px-3 py-2">${roleText}</span>
    </div>

    <ul class="list-group list-group-flush mb-3">
      <li class="list-group-item d-flex justify-content-between">
        <span><i class="fas fa-user text-muted"></i> Tài khoản</span>
        <b>${escapeHtml(currentUser.username)}</b>
      </li>
      <li class="list-group-item d-flex justify-content-between">
        <span><i class="fas fa-phone text-muted"></i> SĐT</span>
        <b>${escapeHtml(currentUser.phone || "—")}</b>
      </li>
      <li class="list-group-item d-flex justify-content-between">
        <span><i class="fas fa-calendar text-muted"></i> Ngày tạo</span>
        <b>${formatDate(currentUser.createdAt)}</b>
      </li>
      ${currentUser.role === "victim" ? `
      <li class="list-group-item d-flex justify-content-between">
        <span><i class="fas fa-bell text-muted"></i> Số SOS đã gửi</span>
        <b class="text-danger">${sosCount}</b>
      </li>` : ""}
    </ul>

    <div class="d-flex justify-content-between">
      <button class="btn btn-secondary" data-dismiss="modal">
        <i class="fas fa-times"></i> Đóng
      </button>
      ${currentUser.role !== "admin" ? `
        <button class="btn btn-danger" onclick="deleteMyAccount()">
          <i class="fas fa-user-minus"></i> Xóa tài khoản
        </button>
      ` : `<span class="text-muted small align-self-center">
        <i class="fas fa-info-circle"></i> Admin không thể tự xóa
      </span>`}
    </div>
  `;

  $("#profileModal").modal("show");
}

async function deleteMyAccount() {
  if (!currentUser) return;
  if (currentUser.role === "admin") {
    showToast("❌ Admin không thể tự xóa tài khoản!");
    return;
  }

  const sosCount = (await dbGetSOSByUser(currentUser.id)).length;

  const msg = `⚠️ CẢNH BÁO XÓA TÀI KHOẢN\n\n` +
              `Tài khoản: ${currentUser.username}\n` +
              `Họ tên: ${currentUser.name}\n` +
              `Số SOS đã gửi: ${sosCount}\n\n` +
              `Khi xóa:\n` +
              `• Tài khoản sẽ bị XÓA VĨNH VIỄN\n` +
              `• Tất cả ${sosCount} yêu cầu SOS sẽ bị XÓA THEO\n` +
              `• Không thể khôi phục!\n\n` +
              `Gõ OK để xác nhận.`;

  if (!confirm(msg)) return;

  // Xóa hết SOS của mình
  await dbDeleteSOSByUser(currentUser.id);
  // Xóa user
  await dbDeleteUser(currentUser.id);

  $("#profileModal").modal("hide");
  showToast("🗑️ Đã xóa tài khoản. Tạm biệt!");

  setTimeout(() => {
    doLogout();
  }, 1500);
}

/* ---------- TOAST ---------- */
function showToast(msg) {
  let el = document.getElementById("sosToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "sosToast";
    el.className = "sos-toast";
    document.body.appendChild(el);
  }
  el.innerHTML = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 2800);
}
