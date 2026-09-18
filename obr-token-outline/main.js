import OBR, { buildPath, Command } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

const ID = "com.igor.token-outline";
const META_KEY = `${ID}/effect`;
const SAMPLE_MAX = 280;
const ALPHA_THRESHOLD = 24;

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const infoEl = $("#selection-info");
const outlineSettings = $("#outline-settings");
const applySelectedBtn = $("#apply-selected");
const applyAllBtn = $("#apply-all");
const removeSelectedBtn = $("#remove-selected");
const colorInput = $("#color");
const colorText = $("#color-text");
const widthInput = $("#width");
const widthNumber = $("#width-number");

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

function getMode() {
  return document.querySelector('input[name="mode"]:checked')?.value ?? "outline";
}

function clampWidth(v) {
  return Math.max(1, Math.min(20, Math.round(Number(v) || 1)));
}

function normalizeHex(value) {
  let v = String(value || "").trim().toUpperCase();
  if (!v.startsWith("#")) v = `#${v}`;
  return /^#[0-9A-F]{6}$/.test(v) ? v : null;
}

function getSettings() {
  return {
    mode: getMode(),
    color: normalizeHex(colorText.value) || colorInput.value.toUpperCase(),
    width: clampWidth(widthNumber.value),
  };
}

function syncOutlineVisibility() {
  outlineSettings.classList.toggle("hidden", getMode() === "shadow");
}

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", syncOutlineVisibility);
}

colorInput.addEventListener("input", () => {
  colorText.value = colorInput.value.toUpperCase();
});

colorText.addEventListener("change", () => {
  const normalized = normalizeHex(colorText.value);
  if (normalized) {
    colorText.value = normalized;
    colorInput.value = normalized;
  } else {
    colorText.value = colorInput.value.toUpperCase();
  }
});

widthInput.addEventListener("input", () => {
  widthNumber.value = widthInput.value;
});

widthNumber.addEventListener("input", () => {
  const v = clampWidth(widthNumber.value);
  widthInput.value = String(v);
});

function isCharacterImage(item) {
  return item?.type === "IMAGE" && item?.layer === "CHARACTER";
}

async function getSelectedCharacters() {
  const selection = await OBR.player.getSelection();
  if (!selection?.length) return [];
  const items = await OBR.scene.items.getItems(selection);
  return items.filter(isCharacterImage);
}

async function getAllCharacters() {
  return OBR.scene.items.getItems(isCharacterImage);
}

async function updateSelectionInfo() {
  try {
    const ready = await OBR.scene.isReady();
    if (!ready) {
      infoEl.textContent = "Сцена не открыта.";
      applySelectedBtn.disabled = true;
      applyAllBtn.disabled = true;
      removeSelectedBtn.disabled = true;
      return;
    }
    const chars = await getSelectedCharacters();
    if (chars.length === 0) {
      infoEl.textContent = "Выдели один или несколько токенов на слое Character.";
      applySelectedBtn.disabled = true;
      removeSelectedBtn.disabled = true;
    } else {
      infoEl.textContent = `Выбрано Character-токенов: ${chars.length}`;
      applySelectedBtn.disabled = false;
      removeSelectedBtn.disabled = false;
    }
    applyAllBtn.disabled = false;
  } catch (err) {
    infoEl.textContent = "Не удалось прочитать выделение.";
  }
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadAlphaMask(token) {
  const response = await fetch(token.image.url, { mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const srcW = token.image.width || bitmap.width;
  const srcH = token.image.height || bitmap.height;
  const factor = Math.min(1, SAMPLE_MAX / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * factor));
  const h = Math.max(1, Math.round(srcH * factor));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    mask[p] = data[i + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }
  return { mask, w, h, srcW, srcH, factor };
}

function chamferDistance(mask, w, h, pad) {
  const pw = w + pad * 2;
  const ph = h + pad * 2;
  const size = pw * ph;
  const INF = 1e9;
  const dist = new Float32Array(size);
  const original = new Uint8Array(size);
  dist.fill(INF);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const idx = (y + pad) * pw + (x + pad);
      original[idx] = 1;
      dist[idx] = 0;
    }
  }

  const D = Math.SQRT2;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = y * pw + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - pw] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - pw - 1] + D);
      if (x + 1 < pw && y > 0) d = Math.min(d, dist[i - pw + 1] + D);
      dist[i] = d;
    }
  }
  for (let y = ph - 1; y >= 0; y--) {
    for (let x = pw - 1; x >= 0; x--) {
      const i = y * pw + x;
      let d = dist[i];
      if (x + 1 < pw) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < ph) d = Math.min(d, dist[i + pw] + 1);
      if (x + 1 < pw && y + 1 < ph) d = Math.min(d, dist[i + pw + 1] + D);
      if (x > 0 && y + 1 < ph) d = Math.min(d, dist[i + pw - 1] + D);
      dist[i] = d;
    }
  }
  return { dist, original, pw, ph };
}

function maskToCommands(binary, pw, ph, transform) {
  const commands = [];
  for (let y = 0; y < ph; y++) {
    let x = 0;
    while (x < pw) {
      while (x < pw && !binary[y * pw + x]) x++;
      if (x >= pw) break;
      const start = x;
      while (x < pw && binary[y * pw + x]) x++;
      const end = x;
      const p1 = transform(start, y);
      const p2 = transform(end, y + 1);
      commands.push(
        [Command.MOVE, p1.x, p1.y],
        [Command.LINE, p2.x, p1.y],
        [Command.LINE, p2.x, p2.y],
        [Command.LINE, p1.x, p2.y],
        [Command.CLOSE]
      );
    }
  }
  return commands;
}

function buildBinaryFromDistance(distData, maxDistance, excludeOriginal = false) {
  const { dist, original } = distData;
  const out = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] <= maxDistance && (!excludeOriginal || !original[i])) out[i] = 1;
  }
  return out;
}

function getGridOffset(token) {
  const off = token.grid?.offset;
  if (off && Number.isFinite(off.x) && Number.isFinite(off.y)) return off;
  return { x: token.image.width / 2, y: token.image.height / 2 };
}

function getAverageScale(token) {
  const sx = Math.abs(token.scale?.x ?? 1);
  const sy = Math.abs(token.scale?.y ?? 1);
  return Math.max(0.001, (sx + sy) / 2);
}

async function makeEffectsForToken(token, settings, sceneDpi) {
  const alpha = await loadAlphaMask(token);
  const gridDpi = Number(token.grid?.dpi) || alpha.srcW;
  const baseScenePerSourcePx = sceneDpi / gridDpi;
  const avgScale = getAverageScale(token);
  const sourcePerSample = alpha.srcW / alpha.w;
  const worldPerSample = sourcePerSample * baseScenePerSourcePx * avgScale;

  const outlineRadiusSamples = Math.max(1, Math.ceil(settings.width / Math.max(worldPerSample, 0.01)));
  const shadowOuterWorld = 5;
  const shadowRadiusSamples = Math.max(1, Math.ceil(shadowOuterWorld / Math.max(worldPerSample, 0.01)));
  const pad = Math.max(outlineRadiusSamples, shadowRadiusSamples) + 3;
  const d = chamferDistance(alpha.mask, alpha.w, alpha.h, pad);
  const offset = getGridOffset(token);

  const transform = (sampleX, sampleY) => {
    const srcX = ((sampleX - pad) / alpha.w) * alpha.srcW;
    const srcY = ((sampleY - pad) / alpha.h) * alpha.srcH;
    return {
      x: (srcX - offset.x) * baseScenePerSourcePx,
      y: (srcY - offset.y) * baseScenePerSourcePx,
    };
  };

  const common = (builder, kind, position = token.position) => builder
    .name(`Token Outline — ${kind}`)
    .position(position)
    .rotation(token.rotation || 0)
    .scale(token.scale || { x: 1, y: 1 })
    .layer("CHARACTER")
    .zIndex((token.zIndex ?? 0) - (kind === "outline" ? 0.01 : 0.02))
    .disableAutoZIndex(true)
    .disableHit(true)
    .locked(true)
    .attachedTo(token.id)
    .metadata({ [META_KEY]: { parentId: token.id, kind, version: 1 } });

  const items = [];

  if (settings.mode === "outline" || settings.mode === "both") {
    const outlineMask = buildBinaryFromDistance(d, outlineRadiusSamples, true);
    const commands = maskToCommands(outlineMask, d.pw, d.ph, transform);
    if (commands.length) {
      const path = common(
        buildPath()
          .commands(commands)
          .fillColor(settings.color)
          .fillOpacity(1)
          .strokeOpacity(0)
          .fillRule("evenodd"),
        "outline"
      ).build();
      items.push(path);
    }
  }

  if (settings.mode === "shadow" || settings.mode === "both") {
    const angle = ((token.rotation || 0) * Math.PI) / 180;
    const localOffset = { x: 4, y: 6 };
    // Offset in world coordinates, rotated with the token's current orientation.
    const dx = localOffset.x * Math.cos(angle) - localOffset.y * Math.sin(angle);
    const dy = localOffset.x * Math.sin(angle) + localOffset.y * Math.cos(angle);
    const shadowPos = { x: token.position.x + dx, y: token.position.y + dy };

    const shadowMask = buildBinaryFromDistance(d, shadowRadiusSamples, false);
    const commands = maskToCommands(shadowMask, d.pw, d.ph, transform);
    if (commands.length) {
      const path = common(
        buildPath()
          .commands(commands)
          .fillColor("#000000")
          .fillOpacity(0.22)
          .strokeColor("#000000")
          .strokeOpacity(0.08)
          .strokeWidth(2)
          .fillRule("evenodd"),
        "shadow",
        shadowPos
      ).build();
      items.push(path);
    }
  }

  return items;
}

async function deleteEffects(parentIds) {
  const idSet = new Set(parentIds);
  const effects = await OBR.scene.items.getItems((item) => {
    const meta = item.metadata?.[META_KEY];
    return Boolean(meta && idSet.has(meta.parentId));
  });
  if (effects.length) await OBR.scene.items.deleteItems(effects.map((i) => i.id));
  return effects.length;
}

async function applyTo(tokens) {
  if (!tokens.length) {
    setStatus("Нет подходящих Character-токенов.", "error");
    return;
  }

  const settings = getSettings();
  const sceneDpi = await OBR.scene.grid.getDpi();
  applySelectedBtn.disabled = true;
  applyAllBtn.disabled = true;
  removeSelectedBtn.disabled = true;

  let ok = 0;
  let failed = 0;
  setStatus(`Обработка: 0 / ${tokens.length}…`);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      await deleteEffects([token.id]);
      const items = await makeEffectsForToken(token, settings, sceneDpi);
      if (items.length) await OBR.scene.items.addItems(items);
      ok++;
    } catch (err) {
      console.error("Token Outline:", token.name, err);
      failed++;
    }
    setStatus(`Обработка: ${i + 1} / ${tokens.length}…`);
  }

  if (failed) {
    setStatus(`Готово: ${ok}. Ошибок: ${failed}. Обычно причина — CORS у исходной картинки.`, "error");
  } else {
    setStatus(`Готово. Обработано токенов: ${ok}.`, "ok");
  }
  await updateSelectionInfo();
}

applySelectedBtn.addEventListener("click", async () => {
  try {
    await applyTo(await getSelectedCharacters());
  } catch (err) {
    console.error(err);
    setStatus("Не удалось применить эффект.", "error");
  }
});

applyAllBtn.addEventListener("click", async () => {
  try {
    await applyTo(await getAllCharacters());
  } catch (err) {
    console.error(err);
    setStatus("Не удалось применить эффект ко всем токенам.", "error");
  }
});

removeSelectedBtn.addEventListener("click", async () => {
  try {
    const tokens = await getSelectedCharacters();
    const count = await deleteEffects(tokens.map((t) => t.id));
    setStatus(count ? `Удалено объектов эффекта: ${count}.` : "На выбранных токенах эффектов нет.", count ? "ok" : "");
    await updateSelectionInfo();
  } catch (err) {
    console.error(err);
    setStatus("Не удалось удалить эффект.", "error");
  }
});

OBR.onReady(async () => {
  syncOutlineVisibility();
  await updateSelectionInfo();
  OBR.player.onChange(updateSelectionInfo);
  OBR.scene.onReadyChange(updateSelectionInfo);
});
