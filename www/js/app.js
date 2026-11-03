import { MAX_SIDE, JPEG_QUALITY, FORM_KEY } from './config.js';
import { loadFloors, populateFloors, updateFloorInfo } from './floors.js';
import { savePhoto, loadPhotos, deletePhotoFromDB, clearPhotosInDB } from './storage.js';
import { exportBackup, requestPersistentStorage, getLastBackup } from './backup.js';

const state = {
  currentAddressStr: 'Endereço não identificado',
  currentLat: null,
  currentLng: null,
  capturedPhotos: [],
  galleryUrls: [],
  pendingMeta: null,
  previewImage: null,
  originalPhotoBlob: null,
  watermarkStyle: localStorage.getItem('vistoriaWatermarkStyle') || 'compact',
  floors: []
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showBusy(message) {
  const busyText = document.getElementById('busyText');
  const busyProgress = document.getElementById('busyProgress');
  const busyOverlay = document.getElementById('busyOverlay');

  if (busyText) busyText.textContent = message || 'Processando...';
  if (busyProgress) busyProgress.textContent = '';
  if (busyOverlay) busyOverlay.classList.remove('hidden');
}

function setBusyProgress(message) {
  const busyProgress = document.getElementById('busyProgress');
  if (busyProgress) busyProgress.textContent = message;
}

function hideBusy() {
  const busyOverlay = document.getElementById('busyOverlay');
  if (busyOverlay) busyOverlay.classList.add('hidden');
}

function saveForm() {
  try {
    const fields = ['buildingName', 'inspectorName', 'inspectorSector', 'floorSelect', 'environmentSelect', 'environmentCustomInput'];
    const data = {};

    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) data[id] = el.value;
    });

    localStorage.setItem(FORM_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Não foi possível salvar o formulário:', error);
  }
}

function restoreForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) || '{}');
    const fields = ['buildingName', 'inspectorName', 'inspectorSector', 'floorSelect', 'environmentSelect', 'environmentCustomInput'];

    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el && saved[id] !== undefined && saved[id] !== '') {
        el.value = saved[id];
      }
    });
  } catch (error) {
    console.warn('Não foi possível recuperar o formulário:', error);
  }

  const buildingEl = document.getElementById('buildingName');
  const header = document.getElementById('headerBuildingName');
  if (buildingEl && header) {
    header.textContent = buildingEl.value || 'Sapphire Tower';
  }

  handleEnvironmentChange();
}

function bindFormPersistence() {
  const fields = ['buildingName', 'inspectorName', 'inspectorSector', 'floorSelect', 'environmentSelect', 'environmentCustomInput'];

  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', saveForm);
    el.addEventListener('change', saveForm);
  });
}

function getSelectedEnvironment() {
  const select = document.getElementById('environmentSelect');
  const customInput = document.getElementById('environmentCustomInput');

  if (!select) return 'Geral';

  if (select.value === 'OUTRO') {
    return customInput && customInput.value.trim() ? customInput.value.trim() : 'Geral';
  }

  return select.value;
}

function handleEnvironmentChange() {
  const select = document.getElementById('environmentSelect');
  const customInput = document.getElementById('environmentCustomInput');

  if (!select || !customInput) return;

  if (select.value === 'OUTRO') {
    customInput.classList.remove('hidden');
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
  }

  saveForm();
}

function setGeoText(coordText, addressText) {
  const geoCoordinates = document.getElementById('geoCoordinates');
  const geoAddress = document.getElementById('geoAddress');
  if (geoCoordinates && coordText !== undefined) {
    geoCoordinates.innerHTML = `<strong>GPS:</strong> ${escapeHtml(coordText)}`;
  }
  if (geoAddress && addressText !== undefined) {
    geoAddress.innerHTML = `<strong>Endereço da Obra:</strong> ${escapeHtml(addressText)}`;
  }
}

function getLocation() {
  state.currentLat = null;
  state.currentLng = null;
  state.currentAddressStr = 'Endereço não identificado';

  if (!('geolocation' in navigator)) {
    setGeoText('Geolocalização indisponível', state.currentAddressStr);
    return;
  }

  setGeoText('Capturando...', '—');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.currentLat = pos.coords.latitude.toFixed(6);
    state.currentLng = pos.coords.longitude.toFixed(6);
    setGeoText(`${state.currentLat}, ${state.currentLng}`, 'Buscando endereço...');

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${state.currentLat}&lon=${state.currentLng}`
      );
      if (!response.ok) throw new Error('Falha na geocodificação reversa');
      const data = await response.json();

      const rua = data.address?.road || data.address?.pedestrian || '';
      const cidade = data.address?.city || data.address?.town || data.address?.village || '';
      const uf = (data.address?.['ISO3166-2-lvl4'] || '').split('-')[1] || '';

      const partes = [rua, [cidade, uf].filter(Boolean).join(' - ')].filter(Boolean);
      state.currentAddressStr = partes.length ? partes.join(', ') : 'Endereço não identificado';
    } catch (error) {
      state.currentAddressStr = 'Endereço não identificado';
    }

    setGeoText(`${state.currentLat}, ${state.currentLng}`, state.currentAddressStr);
    if (state.previewImage) drawWatermarkedImage(state.previewImage);
  }, () => {
    state.currentLat = null;
    state.currentLng = null;
    state.currentAddressStr = 'Endereço não identificado';
    setGeoText('GPS indisponível (permissão negada ou sinal fraco)', state.currentAddressStr);
    if (state.previewImage) drawWatermarkedImage(state.previewImage);
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function processImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    URL.revokeObjectURL(url);
    state.previewImage = image;
    state.originalPhotoBlob = file;
    drawWatermarkedImage(image);
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Não foi possível ler esta imagem. Tente novamente.');
  };

  image.src = url;
}

function drawWatermarkLayer(canvas, meta, style) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const building = String(meta.building || 'EMPREENDIMENTO').toUpperCase();
  const floor = String(meta.floor || 'Não informado').toUpperCase();
  const env = String(meta.env || 'Geral').toUpperCase();
  const dateStr = meta.timestamp || new Date().toLocaleString('pt-BR');
  const locationText = meta.location && meta.location !== 'Endereço não identificado'
    ? meta.location
    : '';

  const lines = [
    building,
    `PAVIMENTO: ${floor} | AMBIENTE: ${env}`,
    `DATA/HORA: ${dateStr}`,
    ...(locationText ? [`LOCALIZAÇÃO: ${locationText}`] : [])
  ];

  const fontSize = Math.max(10, Math.min(24, Math.round(canvas.width / (style === 'compact' ? 58 : 48))));
  const padding = Math.max(7, fontSize * 0.7);
  const lineHeight = fontSize * 1.35;
  ctx.font = `bold ${fontSize}px sans-serif`;

  const maxTextWidth = style === 'compact' ? canvas.width * 0.72 - padding * 2 : canvas.width - padding * 2;
  const fitLine = (text) => {
    let value = text;
    while (value.length > 3 && ctx.measureText(value).width > maxTextWidth) value = value.slice(0, -2);
    if (value !== text) value = value.replace(/[\\s|,;:-]+$/, '') + '…';
    return value;
  };
  const displayLines = lines.map(fitLine);
  const boxHeight = displayLines.length * lineHeight + padding * 2;
  const compactWidth = Math.min(canvas.width - padding * 2, Math.max(...displayLines.map(line => ctx.measureText(line).width)) + padding * 2);
  const x = style === 'compact' || style === 'minimal' ? canvas.width - compactWidth - padding : 0;
  const y = style === 'top' ? 0 : canvas.height - boxHeight - padding;

  if (style === 'compact') {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
    ctx.fillRect(x, y, compactWidth, boxHeight);
    ctx.fillStyle = '#2A9DAD';
    ctx.fillRect(x, y, Math.max(3, fontSize * 0.18), boxHeight);
  } else if (style === 'minimal') {
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
  } else {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(0, y, canvas.width, boxHeight + padding);
    ctx.fillStyle = '#2A9DAD';
    ctx.fillRect(0, style === 'top' ? y + boxHeight + padding - 3 : y, canvas.width, 3);
  }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  displayLines.forEach((line, index) => {
    const textX = style === 'compact' || style === 'minimal' ? x + padding : padding;
    const textY = y + padding + (index + 1) * lineHeight - fontSize * 0.2;
    ctx.fillText(line, textX, textY);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function drawWatermarkedImage(image) {
  const canvas = document.getElementById('photoCanvas');
  if (!canvas) return;

  const srcWidth = image.naturalWidth || image.width;
  const srcHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(srcWidth, srcHeight));

  canvas.width = Math.round(srcWidth * scale);
  canvas.height = Math.round(srcHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const now = new Date();
  const meta = {
    building: document.getElementById('buildingName').value.trim() || 'EMPREENDIMENTO',
    floor: document.getElementById('floorSelect').value.trim() || 'Não informado',
    env: getSelectedEnvironment(),
    location: state.currentAddressStr,
    lat: state.currentLat,
    lng: state.currentLng,
    timestamp: now.toLocaleString('pt-BR'),
    createdAt: now.getTime()
  };

  drawWatermarkLayer(canvas, meta, state.watermarkStyle || 'compact');
  state.pendingMeta = meta;

  const preview = document.getElementById('previewContainer');
  if (preview) preview.classList.remove('hidden');
}

async function createWatermarkedBlob(photo) {
  const sourceUrl = URL.createObjectURL(photo.blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível preparar uma fotografia para o PDF.'));
      img.src = sourceUrl;
    });

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar a imagem para o PDF.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    drawWatermarkLayer(canvas, {
      building: photo.building || document.getElementById('buildingName').value.trim() || 'EMPREENDIMENTO',
      floor: photo.floor,
      env: photo.env,
      location: photo.location,
      timestamp: photo.timestamp
    }, photo.watermarkStyle || state.watermarkStyle || 'compact');

    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao aplicar a marca-d’água para o PDF.')), 'image/jpeg', JPEG_QUALITY);
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function handleWatermarkStyleChange() {
  const select = document.getElementById('watermarkStyle');
  if (!select) return;
  state.watermarkStyle = select.value;
  try { localStorage.setItem('vistoriaWatermarkStyle', state.watermarkStyle); } catch (error) {}
  if (state.previewImage) drawWatermarkedImage(state.previewImage);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Falha ao gerar a imagem'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

async function addPhotoToInspection() {
  if (!state.pendingMeta) return;

  const btn = document.getElementById('addPhotoBtn');
  if (btn) btn.disabled = true;

  try {
    const canvas = document.getElementById('photoCanvas');
    // O armazenamento recebe o arquivo original; o canvas com marca-d'água é apenas preview.
    const blob = state.originalPhotoBlob;
    if (!(blob instanceof Blob)) throw new Error('A fotografia original não está disponível. Carregue a imagem novamente.');
    const notes = document.getElementById('photoNotes').value || 'Sem inconformidades anotadas.';

    await savePhoto({
      floor: state.pendingMeta.floor,
      env: state.pendingMeta.env,
      notes,
      blob,
      building: state.pendingMeta.building,
      watermarkStyle: state.watermarkStyle || 'compact',
      location: state.pendingMeta.location,
      lat: state.pendingMeta.lat,
      lng: state.pendingMeta.lng,
      timestamp: state.pendingMeta.timestamp,
      createdAt: state.pendingMeta.createdAt
    });

    state.capturedPhotos = await loadPhotos();
    renderGallery();

    state.pendingMeta = null;
    state.previewImage = null;
    state.originalPhotoBlob = null;
    const preview = document.getElementById('previewContainer');
    if (preview) preview.classList.add('hidden');
    const cameraInput = document.getElementById('cameraInput');
    if (cameraInput) cameraInput.value = '';
    const photoNotes = document.getElementById('photoNotes');
    if (photoNotes) photoNotes.value = '';

    alert('✅ Foto e observação salvas no relatório!');
  } catch (error) {
    console.error(error);
    alert('Não foi possível salvar a foto.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderGallery() {
  const gallery = document.getElementById('gallery');
  const photoCount = document.getElementById('photoCount');

  if (photoCount) photoCount.textContent = String(state.capturedPhotos.length);

  state.galleryUrls.forEach((url) => URL.revokeObjectURL(url));
  state.galleryUrls = [];

  if (!gallery) return;

  if (state.capturedPhotos.length === 0) {
    gallery.innerHTML = '<p id="emptyGallery" class="col-span-2 text-xs text-gray-400 text-center py-4">Nenhuma foto adicionada ao relatório ainda.</p>';
    return;
  }

  gallery.innerHTML = state.capturedPhotos.map((item) => {
    const url = URL.createObjectURL(item.blob);
    state.galleryUrls.push(url);

    return `
      <div class="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50 shadow-sm flex flex-col">
        <img src="${url}" class="w-full h-32 object-cover" alt="Foto da vistoria" />
        <div class="p-2 text-[10px] space-y-1">
          <p class="font-bold text-slate-800">${escapeHtml(item.floor)}</p>
          <p class="text-[#135C6C] font-semibold truncate">Ambiente: ${escapeHtml(item.env)}</p>
          <p class="text-gray-500 line-clamp-2">${escapeHtml(item.notes)}</p>
        </div>
        <button type="button" onclick="window.removePhoto && window.removePhoto(${item.id})" class="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 shadow hover:bg-red-700">
          <i data-lucide="x" class="w-3 h-3"></i>
        </button>
      </div>
    `;
  }).join('');

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

async function removePhoto(id) {
  if (!confirm('Remover esta foto do relatório?')) return;

  try {
    await deletePhotoFromDB(id);
    state.capturedPhotos = state.capturedPhotos.filter((photo) => photo.id !== id);
    renderGallery();
  } catch (error) {
    console.error(error);
    alert('Não foi possível remover a foto.');
  }
}

// Há fotos mais novas que o último backup concluído neste aparelho (ou nunca houve backup)?
function hasPhotosWithoutBackup() {
  const last = getLastBackup();
  if (!last) return true;

  const lastTime = new Date(last.at).getTime();
  return state.capturedPhotos.some((photo) => (photo.createdAt || 0) > lastTime);
}

async function clearAllPhotos() {
  if (state.capturedPhotos.length === 0) return;

  const backupWarning = hasPhotosWithoutBackup()
    ? '\n\n⚠️ Há fotos que ainda NÃO estão em nenhum backup. Toque em "Cancelar" e use o botão Backup antes.'
    : '';

  if (!confirm(`Apagar TODAS as ${state.capturedPhotos.length} fotos do relatório? Esta ação não pode ser desfeita.${backupWarning}`)) return;

  try {
    await clearPhotosInDB();
    state.capturedPhotos = [];
    renderGallery();
  } catch (error) {
    console.error(error);
    alert('Não foi possível limpar o relatório.');
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function generatePDFReport() {
  if (state.capturedPhotos.length === 0) {
    alert('Adicione pelo menos uma foto antes de gerar o relatório em PDF.');
    return;
  }

  showBusy('Gerando Relatório PDF...');

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const building = document.getElementById('buildingName').value || 'Empreendimento';
    const inspector = document.getElementById('inspectorName').value || 'Auditor Técnico';
    const sector = document.getElementById('inspectorSector').value || 'Auditoria Interna';

    const pageWidth = 210;
    const margin = 10;
    const cardWidth = (pageWidth - margin * 2 - 6) / 2;
    const cardHeight = 118;

    let itemsPerPage = 4;
    let col = 0;
    let row = 0;
    let startY = 42;

    doc.setFillColor(19, 92, 108);
    doc.rect(0, 0, pageWidth, 28, 'F');

    // Busca o logo a partir da localização real deste módulo (www/js/app.js).
    // O caminho é independente da URL pela qual o GitHub Pages abriu a aplicação.
    let logoData = null;
    try {
      const logoUrl = new URL('../logo-fg.png', import.meta.url);
      const logoResponse = await fetch(logoUrl.href, { cache: 'no-store' });
      if (!logoResponse.ok) {
        throw new Error(`Falha ao carregar logo: HTTP ${logoResponse.status} — ${logoUrl.href}`);
      }

      const logoBlob = await logoResponse.blob();
      if (!logoBlob.type.includes('image/png')) {
        throw new Error(`Formato inesperado do logo: ${logoBlob.type || 'desconhecido'}`);
      }

      logoData = await blobToBase64(logoBlob);
      const logoProps = doc.getImageProperties(logoData);
      const logoBox = { x: margin, y: 4, width: 28, height: 19 };
      const logoScale = Math.min(logoBox.width / logoProps.width, logoBox.height / logoProps.height);
      const logoWidth = logoProps.width * logoScale;
      const logoHeight = logoProps.height * logoScale;
      const logoX = logoBox.x + (logoBox.width - logoWidth) / 2;
      const logoY = logoBox.y + (logoBox.height - logoHeight) / 2;
      doc.addImage(logoData, 'PNG', logoX, logoY, logoWidth, logoHeight, 'fg-logo', 'FAST');
    } catch (logoError) {
      console.error('ERRO AO INSERIR LOGO NO PDF:', logoError);
      alert('O PDF não conseguiu carregar o logo da FG. Verifique a publicação do arquivo logo-fg.png na raiz do GitHub Pages.');
    }

    const headerTextX = logoData ? 46 : margin;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('RELATÓRIO & VISTORIA FOTOGRÁFICA', headerTextX, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Empreendimento: ${building}`, headerTextX, 18);
    doc.text(`Responsável: ${inspector} (${sector})`, headerTextX, 24);

    for (let index = 0; index < state.capturedPhotos.length; index++) {
      const item = state.capturedPhotos[index];

      if (index > 0 && index % itemsPerPage === 0) {
        doc.addPage();
        col = 0;
        row = 0;
        startY = 15;
      }

      setBusyProgress(`Processando foto ${index + 1} de ${state.capturedPhotos.length}...`);

      const x = margin + col * (cardWidth + 6);
      const y = startY + row * (cardHeight + 6);

      doc.setDrawColor(220, 226, 230);
      doc.setFillColor(250, 252, 253);
      doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

      // A marca-d'água é aplicada somente na cópia temporária usada no PDF.
      const reportImage = await createWatermarkedBlob(item);
      const base64Img = await blobToBase64(reportImage);
      // Mantém a proporção original da fotografia: não estica a imagem nem a marca d'água.
      const imageProps = doc.getImageProperties(base64Img);
      const imageBoxWidth = cardWidth - 4;
      const imageBoxHeight = 75;
      const imageScale = Math.min(
        imageBoxWidth / imageProps.width,
        imageBoxHeight / imageProps.height
      );
      const imageWidth = imageProps.width * imageScale;
      const imageHeight = imageProps.height * imageScale;
      const imageX = x + 2 + (imageBoxWidth - imageWidth) / 2;
      const imageY = y + 2 + (imageBoxHeight - imageHeight) / 2;
      doc.addImage(base64Img, 'JPEG', imageX, imageY, imageWidth, imageHeight);

      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Pavimento: ${item.floor}`, x + 4, y + 83);

      doc.setTextColor(19, 92, 108);
      doc.text(`Ambiente: ${item.env}`, x + 4, y + 88);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8);

      const splitNotes = doc.splitTextToSize(`Obs: ${item.notes || 'Sem observações.'}`, cardWidth - 8);
      doc.text(splitNotes.slice(0, 4), x + 4, y + 94);

      col += 1;
      if (col > 1) {
        col = 0;
        row += 1;
      }
    }

    doc.save(`Relatorio_Vistoria_${building.replace(/\s+/g, '_')}.pdf`);
  } catch (error) {
    console.error(error);
    alert('Ocorreu um erro ao gerar o PDF. Tente novamente.');
  } finally {
    hideBusy();
  }
}

async function initApp() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  try {
    state.floors = await loadFloors();
    populateFloors('floorSelect', state.floors);
  } catch (error) {
    console.error(error);
    alert('Não foi possível carregar o cronograma de pavimentos.');
  }

  restoreForm();
  const watermarkSelect = document.getElementById('watermarkStyle');
  if (watermarkSelect) watermarkSelect.value = state.watermarkStyle;
  // atualiza o card do pavimento DEPOIS de restaurar o pavimento salvo no formulário
  updateFloorInfo('floorSelect', state.floors, 'floorDetailType', 'floorDetailDates');
  bindFormPersistence();
  getLocation();

  requestPersistentStorage();

  try {
    state.capturedPhotos = await loadPhotos();
  } catch (error) {
    console.error(error);
    alert('Não foi possível acessar o armazenamento local do navegador.');
  }

  renderGallery();
}

window.getLocation = getLocation;
window.handleEnvironmentChange = handleEnvironmentChange;
window.processImage = processImage;
window.handleWatermarkStyleChange = handleWatermarkStyleChange;
window.addPhotoToInspection = addPhotoToInspection;
window.removePhoto = removePhoto;
window.clearAllPhotos = clearAllPhotos;
window.exportBackup = exportBackup;
window.generatePDFReport = generatePDFReport;
window.updateFloorInfo = () => updateFloorInfo('floorSelect', state.floors, 'floorDetailType', 'floorDetailDates');

document.addEventListener('DOMContentLoaded', initApp);
