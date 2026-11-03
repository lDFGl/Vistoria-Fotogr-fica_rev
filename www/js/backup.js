import { APP_NAME, DB_NAME, FORM_KEY, STORE } from './config.js';
import { loadPhotos } from './storage.js';

const LAST_BACKUP_KEY = 'vistoria-fg-last-backup-v1';
const BACKUP_FORMAT = 'vistoria-fg-backup';
const BACKUP_VERSION = 1;

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('Não foi possível converter uma fotografia para o backup.'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler fotografia.'));
    reader.readAsDataURL(blob);
  });
}

function safeFileName(value) {
  const normalized = String(value || 'Empreendimento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'Empreendimento';
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
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
      return false;
    }
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
    const form = {};
    const rawForm = localStorage.getItem(FORM_KEY);

    if (rawForm) {
      try {
        Object.assign(form, JSON.parse(rawForm));
      } catch (error) {
        console.warn('Dados do formulário inválidos; backup seguirá sem eles.', error);
      }
    }

    const photosWithData = await Promise.all(photos.map(async (photo) => {
      if (!(photo.blob instanceof Blob)) {
        throw new Error(`A fotografia ${photo.id ?? ''} não possui arquivo válido.`);
      }

      return {
        id: photo.id ?? null,
        floor: photo.floor ?? '',
        env: photo.env ?? '',
        notes: photo.notes ?? '',
        location: photo.location ?? '',
        lat: photo.lat ?? null,
        lng: photo.lng ?? null,
        timestamp: photo.timestamp ?? '',
        createdAt: photo.createdAt ?? null,
        mimeType: photo.blob.type || 'image/jpeg',
        size: photo.blob.size,
        dataBase64: await readAsBase64(photo.blob)
      };
    }));

    const generatedAt = new Date().toISOString();
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: APP_NAME,
      generatedAt,
      storage: { database: DB_NAME, store: STORE },
      form,
      photoCount: photosWithData.length,
      photos: photosWithData
    };

    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    objectUrl = URL.createObjectURL(blob);

    const building = form.buildingName || document.getElementById('buildingName')?.value || 'Empreendimento';
    const datePart = generatedAt.slice(0, 10);
    const fileName = `Backup_Vistoria_${safeFileName(building)}_${datePart}.json`;

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Registra somente após a geração completa do arquivo e o acionamento do download.
    try {
      localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({
        at: generatedAt,
        fileName,
        photoCount: photosWithData.length
      }));
    } catch (error) {
      console.warn('Backup gerado, mas não foi possível registrar a data do último backup.', error);
    }

    alert(`Backup gerado com sucesso!\nArquivo: ${fileName}\nFotografias incluídas: ${photosWithData.length}`);
    return { fileName, photoCount: photosWithData.length };
  } catch (error) {
    console.error('Falha ao gerar backup:', error);
    alert(`Não foi possível gerar o backup. ${error?.message || 'Verifique o armazenamento e tente novamente.'}`);
    throw error;
  } finally {
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    }
  }
}
