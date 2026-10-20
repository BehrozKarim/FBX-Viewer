import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

// If you don't see this exact line in the console, you're running a CACHED old
// version — hard-refresh with Ctrl+Shift+R.
console.log("%c✅ FBX Viewer build: texture-fix-4 (tolerant matching)", "color:#4f8cff;font-weight:bold");

// ---- Scene setup ----------------------------------------------------------
const app = document.getElementById("app");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#1e2129");

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  10000
);
camera.position.set(3, 3, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// ---- Lighting -------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.0);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(5, 10, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 500;
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-5, 3, -5);
scene.add(fill);

// ---- Grid & ground --------------------------------------------------------
const grid = new THREE.GridHelper(20, 20, 0x555a66, 0x33373f);
scene.add(grid);

// ---- State ----------------------------------------------------------------
let currentModel = null;
let mixer = null;
let actions = [];
let activeAction = null;
let animPlaying = true;
let animSpeed = 1;
const clock = new THREE.Clock();

// Dropped image files, indexed three ways so we can tolerate the small filename
// differences that creep in when textures are renamed/re-exported:
//   textureMap       exact basename            "pickaxe.l1_texture.png"
//   textureMapNorm   separators removed        "pickaxel1texturepng"  (. _ - space all equal)
//   textureMapNoExt  separators + ext removed  "pickaxel1texture"     (also allows .tga↔.png)
const textureMap = new Map();
const textureMapNorm = new Map();
const textureMapNoExt = new Map();

const stripExt = (n) => n.replace(/\.[^.]+$/, "");
const normName = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");

const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => {
  // Embedded (base64) textures are self-contained — pass through.
  if (url.startsWith("data:")) {
    console.log("[FBX texture] embedded (base64) texture — OK");
    return url;
  }
  // Extract just the filename. Note: texture URLs arrive here already prefixed
  // with the FBX's location (e.g. "blob:http://…/Pickaxe.L1_Texture.png"), so we
  // must match on the basename, NOT skip everything that starts with "blob:".
  const base = url.split(/[\\/?#]/).pop().toLowerCase();

  // Anything without an image extension (the FBX file's own object URL, etc.)
  // is not a texture request — leave it untouched.
  if (!IMAGE_RE.test(base)) return url;

  const hit = findTexture(base);
  console.log(
    `[FBX texture] FBX requests "%c${base}%c"  →  ${hit ? `MATCHED ✓ (${hit.tier})` : "NOT FOUND ✗"}`,
    "color:#4f8cff", "color:inherit"
  );
  if (!hit) {
    console.warn(
      `   ↳ full path in FBX: "${url}"\n` +
      `   ↳ files you dropped: ${[...textureMap.keys()].join(", ") || "(none)"}`
    );
  }
  return hit ? hit.url : url;
});

const loader = new FBXLoader(manager);

const IMAGE_RE = /\.(png|jpe?g|bmp|tga|gif|webp)$/i;

function clearTextureMap() {
  for (const objUrl of textureMap.values()) URL.revokeObjectURL(objUrl);
  textureMap.clear();
  textureMapNorm.clear();
  textureMapNoExt.clear();
}

// Look a texture up by exact name, then by normalized name, then ignoring the
// extension. Returns { url, tier } or null.
function findTexture(base) {
  if (textureMap.has(base)) return { url: textureMap.get(base), tier: "exact" };
  const n = normName(base);
  if (textureMapNorm.has(n)) return { url: textureMapNorm.get(n), tier: "normalized" };
  const ne = normName(stripExt(base));
  if (textureMapNoExt.has(ne)) return { url: textureMapNoExt.get(ne), tier: "name-only" };
  return null;
}

// ---- DOM refs -------------------------------------------------------------
const dropHint = document.getElementById("drop-hint");
const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const panel = document.getElementById("panel");
const errorEl = document.getElementById("error");
const fileInput = document.getElementById("file-input");

// ---- File loading ---------------------------------------------------------
document.getElementById("pick-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) loadFiles(Array.from(e.target.files));
});

// Drag & drop over the whole window
["dragenter", "dragover"].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    app.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && e.relatedTarget) return;
    app.classList.remove("dragover");
  })
);
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const items = e.dataTransfer.items;
  let files;
  // Prefer the entry API so dropped folders get recursed into.
  if (items && items.length && items[0].webkitGetAsEntry) {
    files = await getFilesFromItems(items);
  } else {
    files = Array.from(e.dataTransfer.files);
  }
  if (files.length) loadFiles(files);
});

// Recurse into any dropped directories and return a flat list of File objects.
async function getFilesFromItems(items) {
  const entries = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  const files = [];
  async function walk(entry) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns results in batches; loop until empty.
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e);
      } while (batch.length > 0);
    }
  }
  for (const entry of entries) await walk(entry);
  return files;
}

// Entry point: takes any mix of files, finds the .fbx, and registers images.
function loadFiles(files) {
  const fbx = files.find((f) => f.name.toLowerCase().endsWith(".fbx"));
  if (!fbx) {
    showError("No .fbx file found. Drop the model together with its textures.");
    return;
  }

  // Register dropped images so the manager can resolve them by filename.
  clearTextureMap();
  const images = files.filter((f) => IMAGE_RE.test(f.name));
  for (const img of images) {
    const objUrl = URL.createObjectURL(img);
    const name = img.name.toLowerCase();
    textureMap.set(name, objUrl);
    textureMapNorm.set(normName(name), objUrl);
    textureMapNoExt.set(normName(stripExt(name)), objUrl);
  }

  loadFbx(fbx, images.length);
}

function loadFbx(file, textureCount) {
  hideError();
  loadingText.textContent = textureCount
    ? `Loading ${file.name} (+${textureCount} texture${textureCount > 1 ? "s" : ""})…`
    : `Loading ${file.name}…`;
  loadingEl.classList.remove("hidden");

  const url = URL.createObjectURL(file);
  loader.load(
    url,
    (object) => {
      URL.revokeObjectURL(url);
      onModelLoaded(object, file.name);
      loadingEl.classList.add("hidden");
    },
    undefined,
    (err) => {
      URL.revokeObjectURL(url);
      loadingEl.classList.add("hidden");
      console.error(err);
      showError(`Failed to load "${file.name}". It may be corrupt or an unsupported FBX variant.`);
    }
  );
}

// Diagnose why a model might render black, and apply the two most common fixes:
//   (1) diffuse maps must be flagged as sRGB or they look wrong/dark
//   (2) many FBX exports set the base color to black; with a map present that
//       black multiplies the texture to black — reset such colors to white.
function inspectAndFixMaterials(object) {
  const seen = new Set();
  let withMap = 0, withoutMap = 0, blackColorFixed = 0, missingUV = 0;

  object.traverse((child) => {
    if (!child.isMesh) return;
    const hasUV = !!child.geometry?.attributes?.uv;
    if (!hasUV) missingUV++;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);

      if (m.map) {
        withMap++;
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.map.needsUpdate = true;
        // Black/near-black base color hides the texture — normalize to white.
        if (m.color && m.color.getHex() < 0x0a0a0a) {
          m.color.setHex(0xffffff);
          blackColorFixed++;
        }
      } else {
        withoutMap++;
      }
      m.needsUpdate = true;
    }
  });

  console.log(
    `%c[FBX materials]%c maps bound: ${withMap} · no map: ${withoutMap}` +
    ` · black-color fixed: ${blackColorFixed} · meshes missing UVs: ${missingUV}`,
    "color:#4f8cff;font-weight:bold", "color:inherit"
  );
  if (withMap === 0) {
    console.warn(
      "[FBX materials] No textures were bound to any material. " +
      "Check the '[FBX texture] … NOT FOUND' lines above — the filename the FBX " +
      "wants probably doesn't match the .png you dropped."
    );
  }
  if (missingUV > 0) {
    console.warn(
      `[FBX materials] ${missingUV} mesh(es) have no UV coordinates, so textures ` +
      "cannot map onto them. This is a problem with how the model was exported."
    );
  }
}

function onModelLoaded(object, name) {
  clearModel();
  currentModel = object;

  // Enable shadows and collect stats
  let meshCount = 0, vertCount = 0, triCount = 0;
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      meshCount++;
      const geo = child.geometry;
      if (geo?.attributes?.position) {
        vertCount += geo.attributes.position.count;
        triCount += geo.index
          ? geo.index.count / 3
          : geo.attributes.position.count / 3;
      }
    }
  });

  inspectAndFixMaterials(object);

  // Normalize scale & center so any model fits the view nicely
  frameModel(object);
  scene.add(object);

  // Animations
  actions = [];
  activeAction = null;
  mixer = null;
  const animSelect = document.getElementById("anim-select");
  animSelect.innerHTML = "";
  if (object.animations && object.animations.length) {
    mixer = new THREE.AnimationMixer(object);
    object.animations.forEach((clip, i) => {
      actions.push(mixer.clipAction(clip));
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = clip.name || `Clip ${i + 1}`;
      animSelect.appendChild(opt);
    });
    activeAction = actions[0];
    activeAction.play();
    animPlaying = true;
    document.getElementById("play-btn").textContent = "⏸ Pause";
    document.getElementById("anim-section").classList.remove("hidden");
  } else {
    document.getElementById("anim-section").classList.add("hidden");
  }

  // Update UI
  document.getElementById("model-name").textContent = name;
  document.getElementById("model-name").title = name;
  document.getElementById("stat-meshes").textContent = meshCount;
  document.getElementById("stat-verts").textContent = vertCount.toLocaleString();
  document.getElementById("stat-tris").textContent = Math.round(triCount).toLocaleString();
  document.getElementById("stat-anims").textContent = object.animations?.length || 0;

  dropHint.classList.add("hidden");
  panel.classList.remove("hidden");
}

// Center the model at the origin and fit the camera to it
function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Recenter on origin (sitting on the grid)
  object.position.x += -center.x;
  object.position.z += -center.z;
  object.position.y += -box.min.y;

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 1.8;
  camera.position.set(dist * 0.7, dist * 0.6, dist);
  camera.near = maxDim / 100;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, size.y * 0.4, 0);
  controls.maxDistance = maxDim * 10;
  controls.update();
  saveHomeCamera();

  // Scale grid roughly to model footprint
  const gridSize = Math.max(10, Math.ceil(maxDim * 2));
  scene.remove(grid);
  const divisions = gridSize;
  const newGrid = new THREE.GridHelper(gridSize, divisions, 0x555a66, 0x33373f);
  newGrid.visible = grid.visible;
  scene.add(newGrid);
  gridRef.current = newGrid;
}

const gridRef = { current: grid };

function clearModel() {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m?.dispose());
      }
    });
    currentModel = null;
  }
  if (mixer) mixer.stopAllAction();
  mixer = null;
}

// ---- Camera home ----------------------------------------------------------
let homeCam = { pos: camera.position.clone(), target: controls.target.clone() };
function saveHomeCamera() {
  homeCam = { pos: camera.position.clone(), target: controls.target.clone() };
}

// ---- Controls wiring ------------------------------------------------------
document.getElementById("toggle-wireframe").addEventListener("change", (e) => {
  if (!currentModel) return;
  currentModel.traverse((child) => {
    if (child.isMesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => { if (m) m.wireframe = e.target.checked; });
    }
  });
});

document.getElementById("toggle-grid").addEventListener("change", (e) => {
  gridRef.current.visible = e.target.checked;
});

document.getElementById("toggle-autorotate").addEventListener("change", (e) => {
  controls.autoRotate = e.target.checked;
  controls.autoRotateSpeed = 2.0;
});

document.getElementById("bg-color").addEventListener("input", (e) => {
  scene.background = new THREE.Color(e.target.value);
});

document.getElementById("reset-btn").addEventListener("click", () => {
  camera.position.copy(homeCam.pos);
  controls.target.copy(homeCam.target);
  controls.update();
});

document.getElementById("screenshot-btn").addEventListener("click", () => {
  renderer.render(scene, camera);
  const link = document.createElement("a");
  link.download = (document.getElementById("model-name").textContent || "view") + ".png";
  link.href = renderer.domElement.toDataURL("image/png");
  link.click();
});

document.getElementById("close-btn").addEventListener("click", () => {
  clearModel();
  panel.classList.add("hidden");
  dropHint.classList.remove("hidden");
});

// Animation controls
document.getElementById("anim-select").addEventListener("change", (e) => {
  const idx = parseInt(e.target.value, 10);
  if (activeAction) activeAction.stop();
  activeAction = actions[idx];
  activeAction.reset().play();
  activeAction.paused = !animPlaying;
});

document.getElementById("play-btn").addEventListener("click", () => {
  animPlaying = !animPlaying;
  if (activeAction) activeAction.paused = !animPlaying;
  document.getElementById("play-btn").textContent = animPlaying ? "⏸ Pause" : "▶ Play";
});

document.getElementById("anim-speed").addEventListener("input", (e) => {
  animSpeed = parseFloat(e.target.value);
});

// ---- Resize ---------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Error helpers --------------------------------------------------------
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
}
function hideError() {
  errorEl.classList.add("hidden");
}

// ---- Render loop ----------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (mixer && animPlaying) mixer.update(delta * animSpeed);
  controls.update();
  renderer.render(scene, camera);
}
animate();
