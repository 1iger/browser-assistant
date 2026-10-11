const $ = (id) => document.getElementById(id);

let channelNames = {};

async function getState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'vkpoints:getState' }, (resp) => {
      channelNames = (resp && resp.channelNames) || {};
      resolve(resp || {});
    });
  });
}

async function getHistory() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'vkpoints:getHistory' }, (resp) => {
      channelNames = (resp && resp.channelNames) || {};
      resolve((resp && resp.history) || []);
    });
  });
}

function displayName(channel) {
  const c = channelNames[channel];
  if (c && (c.nick || c.title)) return c.nick || c.title;
  return channel;
}

function applyFilters(history) {
  const platform = $('filterPlatform').value;
  const period = parseInt($('filterPeriod').value, 10);
  const channelQuery = $('filterChannel').value.trim().toLowerCase();

  const cutoff = period && !isNaN(period)
    ? Date.now() - period * 24 * 60 * 60 * 1000
    : null;

  return history.filter((e) => {
    if (platform !== 'all' && e.platform !== platform) return false;
    if (cutoff && e.t < cutoff) return false;
    if (channelQuery && !e.channel.toLowerCase().includes(channelQuery)) return false;
    return true;
  });
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderTotals(history) {
  const totalCount = history.length;
  const totalAmount = history.reduce((s, e) => s + (e.amount || 0), 0);
  const channels = new Set(history.map((e) => (e.platform === 'vk' ? 'vk:' : 'tw:') + e.channel));
  $('totalCount').textContent = totalCount;
  $('totalAmount').textContent = totalAmount;
  $('active').textContent = channels.size;
}

function renderTable(history) {
  const tbody = $('history').querySelector('tbody');
  tbody.innerHTML = '';
  history.slice(0, 30).forEach((e) => {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = fmtDate(e.t);
    const tdPlat = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'platform-tag ' + (e.platform === 'vk' ? 'vk' : 'twitch');
    tag.textContent = e.platform === 'vk' ? 'VK' : 'Twitch';
    tdPlat.appendChild(tag);
    const tdChan = document.createElement('td');
    tdChan.textContent = displayName(e.channel);
    const tdAmt = document.createElement('td');
    tdAmt.textContent = '+' + (e.amount || 0);
    tr.appendChild(tdTime);
    tr.appendChild(tdPlat);
    tr.appendChild(tdChan);
    tr.appendChild(tdAmt);
    tbody.appendChild(tr);
  });
}

function drawBarChart(canvas, labels, values, colors) {
  if (!canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 240;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 44, padR = 8, padT = 10, padB = 34;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const max = Math.max(1, ...values);

  ctx.strokeStyle = '#2a3040';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8b94a3';
  ctx.font = '10px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = padT + chartH - (chartH * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(Math.round(max * i / 4), 6, y + 3);
  }

  const n = labels.length;
  if (n === 0) {
    ctx.fillStyle = '#8b94a3';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Нет данных', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }

  const slot = chartW / n;
  const barW = Math.min(34, slot * 0.6);
  labels.forEach((label, i) => {
    const bh = (values[i] / max) * chartH;
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + chartH - bh;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barW, bh);
    ctx.fillStyle = '#8b94a3';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const short = label.length > 12 ? label.slice(0, 11) + '…' : label;
    ctx.fillText(short, padL + slot * i + slot / 2, h - 12);
    ctx.textAlign = 'left';
  });
}

function drawLineChart(canvas, days) {
  if (!canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 240;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 44, padR = 8, padT = 10, padB = 34;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const max = Math.max(1, ...days.values);

  ctx.strokeStyle = '#2a3040';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8b94a3';
  ctx.font = '10px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = padT + chartH - (chartH * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(Math.round(max * i / 4), 6, y + 3);
  }

  const n = days.labels.length;
  if (n === 0) {
    ctx.fillStyle = '#8b94a3';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Нет данных', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }

  const step = chartW / Math.max(1, n - 1);

  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH);
  days.values.forEach((v, i) => {
    const x = padL + step * i;
    const y = padT + chartH - (v / max) * chartH;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(padL + step * (n - 1), padT + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(79,140,255,0.25)';
  ctx.fill();

  ctx.beginPath();
  days.values.forEach((v, i) => {
    const x = padL + step * i;
    const y = padT + chartH - (v / max) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#4f8cff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#8b94a3';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const labelEvery = Math.ceil(n / 6);
  days.labels.forEach((l, i) => {
    if (i % labelEvery !== 0 && i !== n - 1) return;
    const x = padL + step * i;
    ctx.fillText(l, x, h - 12);
  });
  ctx.textAlign = 'left';
}

function buildChannelChart(history) {
  const byChannel = new Map();
  history.forEach((e) => {
    const raw = (e.platform === 'vk' ? 'vk:' : 'tw:') + e.channel;
    const label = (e.platform === 'vk' ? 'vk:' : 'tw:') + displayName(e.channel);
    byChannel.set(raw, {
      label: label,
      sum: (byChannel.get(raw) ? byChannel.get(raw).sum : 0) + (e.amount || 0)
    });
  });
  const sorted = Array.from(byChannel.values()).sort((a, b) => b.sum - a.sum).slice(0, 10);
  const labels = sorted.map((v) => v.label);
  const values = sorted.map((v) => v.sum);
  const colors = ['#4f8cff', '#c084fc', '#5dbf7a', '#f5a623', '#ff7a7a', '#35c2d6', '#ff6fb5', '#a3c4ff'];
  drawBarChart($('byChannel'), labels, values, colors);
}

function buildTimeChart(history) {
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, label: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), sum: 0 });
  }
  const map = new Map(days.map((d) => [d.key, d]));
  history.forEach((e) => {
    const key = new Date(e.t).toISOString().slice(0, 10);
    if (map.has(key)) map.get(key).sum += (e.amount || 0);
  });
  drawLineChart($('byTime'), {
    labels: days.map((d) => d.label),
    values: days.map((d) => d.sum)
  });
}

async function render() {
  const all = await getHistory();
  const filtered = applyFilters(all);
  renderTotals(filtered);
  renderTable(filtered);
  buildChannelChart(filtered);
  buildTimeChart(filtered);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  getHistory().then((history) => {
    const rows = [['Дата', 'Платформа', 'Канал', 'Сумма']];
    history.forEach((e) => {
      rows.push([
        new Date(e.t).toISOString(),
        e.platform === 'vk' ? 'VK' : 'Twitch',
        e.channel,
        e.amount || 0
      ]);
    });
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    download('vkpoints-history.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
  });
}

function exportJson() {
  getHistory().then((history) => {
    download('vkpoints-history.json', JSON.stringify(history, null, 2), 'application/json');
  });
}

function clearHistory() {
  if (!confirm('Очистить всю историю и счётчики?')) return;
  chrome.runtime.sendMessage({ type: 'vkpoints:clearHistory' }, () => {
    render();
  });
}

function showMsg(text) {
  const el = $('msg');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function downloadBackup() {
  chrome.runtime.sendMessage({ type: 'vkpoints:backupNow' }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ok) showMsg('Копия сохранена в папку «Загрузки»');
    else showMsg('Не удалось создать копию');
  });
}

$('restore').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    chrome.runtime.sendMessage(
      { type: 'vkpoints:restoreBackup', json: String(reader.result) },
      (resp) => {
        void chrome.runtime.lastError;
        if (resp && resp.ok) showMsg('Восстановлено записей: ' + resp.count);
        else showMsg((resp && resp.error) || 'Не удалось восстановить');
        render();
      }
    );
  };
  reader.readAsText(f);
  e.target.value = '';
});

['filterPlatform', 'filterPeriod', 'filterChannel'].forEach((id) => {
  $(id).addEventListener('change', render);
});
$('filterChannel').addEventListener('input', render);

$('refresh').addEventListener('click', () => setTimeout(render, 100));
$('exportCsv').addEventListener('click', exportCsv);
$('exportJson').addEventListener('click', exportJson);
$('backup').addEventListener('click', downloadBackup);
$('clear').addEventListener('click', clearHistory);

render();