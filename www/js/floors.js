const FLOORS_URL = new URL('../data/floors.json', import.meta.url);

export async function loadFloors() {
  const response = await fetch(FLOORS_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Falha ao carregar pavimentos (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType && !contentType.includes('json') && !contentType.includes('text/plain')) {
    throw new Error('O arquivo de pavimentos não foi retornado como JSON.');
  }

  const floors = await response.json();
  if (!Array.isArray(floors) || floors.length === 0) {
    throw new Error('O arquivo de pavimentos está vazio ou possui formato inválido.');
  }

  const validFloors = floors.filter((floor) =>
    floor &&
    typeof floor.name === 'string' &&
    floor.name.trim() &&
    typeof floor.type === 'string' &&
    typeof floor.dates === 'string'
  );

  if (validFloors.length !== floors.length) {
    throw new Error('Há registros incompletos no arquivo de pavimentos.');
  }

  return validFloors;
}

export function populateFloors(selectId, floors) {
  const select = document.getElementById(selectId);
  if (!select) throw new Error(`Campo ${selectId} não encontrado na página.`);

  const options = floors.map((floor) => {
    const option = document.createElement('option');
    option.value = floor.name;
    option.textContent = floor.name;
    return option;
  });

  select.replaceChildren(...options);
}

export function updateFloorInfo(selectId, floors, detailTypeId, detailDatesId) {
  const select = document.getElementById(selectId);
  const typeEl = document.getElementById(detailTypeId);
  const datesEl = document.getElementById(detailDatesId);

  if (!select || !typeEl || !datesEl) return;

  const floor = floors.find((item) => item.name === select.value);
  if (!floor) {
    typeEl.textContent = 'Tipologia: -';
    datesEl.textContent = 'Previsão de Montagem: -';
    return;
  }

  typeEl.textContent = `Tipologia: ${floor.type}`;
  datesEl.textContent = `Previsão de Montagem: ${floor.dates}`;
}
