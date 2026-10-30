export async function loadFloors() {
  const response = await fetch('./data/floors.json');
  if (!response.ok) {
    throw new Error('Não foi possível carregar os pavimentos.');
  }

  return response.json();
}

export function populateFloors(selectId, floors) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = floors
    .map((item) => `<option value="${item.name}">${item.name}</option>`)
    .join('');
}

export function updateFloorInfo(selectId, floors, detailTypeId, detailDatesId) {
  const select = document.getElementById(selectId);
  const typeEl = document.getElementById(detailTypeId);
  const datesEl = document.getElementById(detailDatesId);

  if (!select || !typeEl || !datesEl) return;

  const selectedName = select.value;
  const floor = floors.find((item) => item.name === selectedName);

  if (!floor) return;

  typeEl.innerHTML = `<strong>Tipologia:</strong> ${floor.type}`;
  datesEl.innerHTML = `<strong>Previsão de Montagem:</strong> ${floor.dates}`;
}
