import { loadPhotos } from './storage.js';

const LAST_BACKUP_KEY = 'vistoria-fg-last-photo-backup-v1';

function safeFileName(value) {
  return String(value || 'Sem_identificacao')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Sem_identificacao';
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const { dosTime, dosDate } = dosDateTime(file.date || new Date());
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function blobToBytes(blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function getPhotoExtension(blob) {
  const mime = String(blob?.type || '').toLowerCase().split(';')[0].trim();
  const extensions = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/avif': 'avif'
  };
  return extensions[mime] || 'jpg';
}

function getPhotoDate(photo) {
  const parsed = photo.createdAt ? new Date(photo.createdAt) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function getLastBackup() {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.at ? parsed : null;
  } catch (error) {
    console.warn('Não foi possível consultar o último backup:', error);
    return null;
  }
}

export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false;
    return await navigator.storage.persist();
  } catch (error) {
    console.warn('Não foi possível solicitar armazenamento persistente:', error);
    return false;
  }
}

export async function exportBackup() {
  let objectUrl;
  try {
    const photos = await loadPhotos();
    const validPhotos = photos.filter((photo) => photo.blob instanceof Blob);
    if (!validPhotos.length) {
      alert('Não há fotografias salvas para gerar o backup.');
      return { fileName: null, photoCount: 0 };
    }

    const files = [];
    for (let index = 0; index < validPhotos.length; index++) {
      const photo = validPhotos[index];
      const date = getPhotoDate(photo);
      const datePart = date.toISOString().slice(0, 10);
      const floor = safeFileName(photo.floor || 'Pavimento');
      const env = safeFileName(photo.env || 'Ambiente');
      const sequence = String(index + 1).padStart(3, '0');
      files.push({
        name: `${sequence}_${floor}_${env}_${datePart}.${getPhotoExtension(photo.blob)}`,
        data: await blobToBytes(photo.blob),
        date
      });
    }

    const generatedAt = new Date();
    const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
    const fileName = `Backup_Fotos_Vistoria_${stamp}.zip`;
    const zipBlob = createZip(files);
    objectUrl = URL.createObjectURL(zipBlob);

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();

    try {
      localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({
        at: generatedAt.toISOString(),
        count: files.length,
        filename: fileName
      }));
    } catch (error) {
      console.warn('Backup gerado, mas não foi possível registrar a data:', error);
    }

    alert(`Backup das fotografias gerado com sucesso!\nArquivo: ${fileName}\nFotografias incluídas: ${files.length}\nO ZIP contém somente imagens JPG, sem arquivo JSON.`);
    return { fileName, photoCount: files.length };
  } catch (error) {
    console.error('Falha ao gerar backup das fotografias:', error);
    alert(`Não foi possível gerar o backup. ${error?.message || 'Verifique o armazenamento e tente novamente.'}`);
    throw error;
  } finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}
