'use strict';

// Estado global de la aplicación
const state = {
  peers: [],
  savedPeers: [],     // Peers agregados manualmente (guardados en localStorage)
  selectedPeer: null, // { hostname, ip, port, os }
  files: [],          // Archivos recibidos
  transfers: {},      // Cola de transferencias activas: { id: { name, size, progress, status, isFolder } }
  status: null,       // Estado del propio nodo
  peerStatus: {},     // { "ip:port": { isActive: bool, lastChecked: timestamp } }
  incoming: {}        // { uploadId: lastKnownInfo } para detectar nuevos/completados
};

const SAVED_PEERS_KEY = 'localdrop_saved_peers';

// Configuración de URLs de API
const API_BASE = '';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

// Inicializar la aplicación
async function initApp() {
  await fetchSelfStatus();

  // Cargar peers guardados del localStorage
  loadSavedPeers();

  // Polling periódico
  fetchPeers();
  fetchFiles();
  fetchIncoming();   // Lo que está llegando a este equipo
  checkPeerStatus(); // Verificar estado de peers
  renderSavedPeers(); // Mostrar dispositivos guardados

  setInterval(fetchPeers, 2000); // Cada 2 segundos para peers
  setInterval(fetchFiles, 3000); // Cada 3 segundos para archivos recibidos
  setInterval(fetchIncoming, 1000); // Cada 1 segundo para entrantes
  setInterval(checkPeerStatus, 3000); // Cada 3 segundos para verificar status

  setupEvents();
  lucide.createIcons();
}

// Obtener estado del propio servidor
async function fetchSelfStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (res.ok) {
      state.status = await res.json();
      document.getElementById('self-hostname').textContent = `${state.status.hostname} (Este equipo)`;
    }
  } catch (err) {
    console.error('Error al conectar con el servidor local:', err);
    showToast('No se pudo conectar con el backend local', 'error');
  }
}

// Configurar listeners de eventos
function setupEvents() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');
  const addPeerBtn = document.getElementById('open-add-peer-btn');
  const closePeerBtn = document.getElementById('close-add-peer-btn');
  const savePeerBtn = document.getElementById('save-peer-btn');
  const addPeerModal = document.getElementById('add-peer-modal');

  // Trigger input al hacer click en drop zone
  dropZone.addEventListener('click', (e) => {
    // Si hizo click directo o en elementos hijos
    if (e.target.closest('.drop-zone')) {
      showSelectionMenu();
    }
  });

  // Drag & Drop events
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    }, false);
  });

  dropZone.addEventListener('drop', handleDrop, false);

  // Inputs manuales de archivos
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSelectedFiles(Array.from(e.target.files));
    }
  });

  folderInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSelectedFolderFiles(e.target.files);
    }
  });

  // Modal para agregar IP manual
  addPeerBtn.addEventListener('click', () => {
    addPeerModal.classList.remove('hidden');
    document.getElementById('peer-ip-input').focus();
  });

  closePeerBtn.addEventListener('click', () => {
    addPeerModal.classList.add('hidden');
  });

  savePeerBtn.addEventListener('click', handleAddManualPeer);

  // Cerrar modal al presionar Enter en inputs
  [document.getElementById('peer-ip-input'), document.getElementById('peer-port-input')].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleAddManualPeer();
      }
    });
  });
}

// Mostrar menú para elegir si subir Archivo o Carpeta
function showSelectionMenu() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  
  // Dialogo de confirmación simple para saber si es archivo o carpeta
  const container = document.createElement('div');
  container.className = 'modal-overlay';
  container.innerHTML = `
    <div class="modal">
      <h3 class="modal__title">¿Qué querés enviar?</h3>
      <p class="modal__desc">Seleccioná si vas a transferir archivos individuales o una carpeta completa.</p>
      <div class="modal__actions" style="justify-content: center; gap: 16px; margin-top: 16px;">
        <button class="btn-primary" id="select-files-opt">
          <i data-lucide="file"></i> Archivos
        </button>
        <button class="btn-primary" id="select-folder-opt">
          <i data-lucide="folder"></i> Carpeta
        </button>
      </div>
      <div class="modal__actions" style="margin-top: 20px;">
        <button class="btn-secondary" id="cancel-select-opt">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);
  lucide.createIcons();

  container.querySelector('#select-files-opt').addEventListener('click', () => {
    document.getElementById('file-input').click();
    container.remove();
  });

  container.querySelector('#select-folder-opt').addEventListener('click', () => {
    document.getElementById('folder-input').click();
    container.remove();
  });

  container.querySelector('#cancel-select-opt').addEventListener('click', () => {
    container.remove();
  });
}

// Polling de Peers
async function fetchPeers() {
  try {
    const res = await fetch(`${API_BASE}/api/peers`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    // Mezclar peers descubiertos con el seleccionado si es manual y no está en la lista de auto-discovery
    let allPeers = [...data.peers];
    
    if (state.selectedPeer && !allPeers.some(p => p.ip === state.selectedPeer.ip && p.port === state.selectedPeer.port)) {
      allPeers.push(state.selectedPeer);
    }

    state.peers = allPeers;
    renderPeers();
  } catch (err) {
    console.error('Error al obtener peers:', err);
  }
}

// Renderizar lista de peers
function renderPeers() {
  const container = document.getElementById('peers-container');
  if (state.peers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="empty-state__icon" data-lucide="loader" class="loading-spinner"></i>
        <p>Buscando otros dispositivos en la red local...</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let html = '';
  state.peers.forEach(peer => {
    const isSelected = state.selectedPeer && state.selectedPeer.ip === peer.ip && state.selectedPeer.port === peer.port;
    const peerKey = `${peer.ip}:${peer.port}`;
    const peerStatus = state.peerStatus[peerKey];
    const isOnline = peerStatus?.isActive || false;

    html += `
      <div class="peer-item ${isSelected ? 'active' : ''}" onclick="selectPeer('${peer.ip}', ${peer.port})">
        <div class="peer-item__info">
          <div class="peer-item__icon-wrapper">
            <i data-lucide="${peer.os === 'Windows' ? 'monitor-smartphone' : 'monitor-smartphone'}"></i>
          </div>
          <div class="peer-item__details">
            <span class="peer-item__name">${peer.hostname}</span>
            <span class="peer-item__ip">${peer.ip}:${peer.port}</span>
          </div>
        </div>
        <div class="peer-item__meta">
          <span class="peer-item__os-badge">${peer.os}</span>
          <span class="peer-item__status-dot ${isOnline ? 'online' : 'offline'}"></span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();

  // Si hay peers pero ninguno seleccionado, auto-seleccionar el primero
  if (!state.selectedPeer && state.peers.length > 0) {
    state.selectedPeer = state.peers[0];
    renderPeers();
  }
}

// Seleccionar peer
window.selectPeer = function(ip, port) {
  let found = state.peers.find(p => p.ip === ip && p.port === port);
  if (!found) {
    found = state.savedPeers.find(p => p.ip === ip && p.port === port);
  }
  if (found) {
    state.selectedPeer = found;
    renderPeers();
    renderSavedPeers();
    showToast(`Dispositivo destino: ${found.hostname}`, 'info');
  }
};

// Agregar peer manualmente
async function handleAddManualPeer() {
  const ipInput = document.getElementById('peer-ip-input');
  const portInput = document.getElementById('peer-port-input');
  const ip = ipInput.value.trim();
  const port = parseInt(portInput.value.trim()) || 7749;

  if (!ip) {
    showToast('Por favor, ingresá una dirección IP', 'warning');
    return;
  }

  const saveBtn = document.getElementById('save-peer-btn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i data-lucide="loader" class="loading-spinner"></i> Conectando...`;
  lucide.createIcons();

  try {
    // Verificar si el peer responde al endpoint de status
    // Usamos timeout para no bloquear
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`http://${ip}:${port}/api/status`, { signal: controller.signal });
    clearTimeout(id);

    if (res.ok) {
      const remoteStatus = await res.json();
      const newPeer = {
        hostname: remoteStatus.hostname,
        ip: remoteStatus.ip,
        port: remoteStatus.port,
        os: remoteStatus.os,
        lastSeen: Date.now()
      };

      // Agregar a la lista y seleccionar
      state.selectedPeer = newPeer;
      if (!state.savedPeers.some(p => p.ip === newPeer.ip && p.port === newPeer.port)) {
        state.savedPeers.push(newPeer);
        savePeersToLocalStorage(); // Guardar en localStorage
      }

      document.getElementById('add-peer-modal').classList.add('hidden');
      ipInput.value = '';
      showToast(`Dispositivo agregado: ${newPeer.hostname}`, 'success');
      renderPeers();
      renderSavedPeers();
    } else {
      throw new Error();
    }
  } catch (err) {
    showToast('No se pudo establecer conexión con esa IP/Puerto', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Conectar';
  }
}

// Guardar peers en localStorage
function savePeersToLocalStorage() {
  localStorage.setItem(SAVED_PEERS_KEY, JSON.stringify(state.savedPeers));
}

// Cargar peers del localStorage
function loadSavedPeers() {
  try {
    const saved = localStorage.getItem(SAVED_PEERS_KEY);
    if (saved) {
      state.savedPeers = JSON.parse(saved);
    }
  } catch (err) {
    console.error('Error cargando peers guardados:', err);
  }
}

// Verificar si cada peer está activo
async function checkPeerStatus() {
  const allPeers = [...state.peers, ...state.savedPeers];
  for (const peer of allPeers) {
    const key = `${peer.ip}:${peer.port}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const res = await fetch(`http://${peer.ip}:${peer.port}/api/status`, {
        signal: controller.signal,
        mode: 'no-cors'
      });
      clearTimeout(timeout);
      state.peerStatus[key] = { isActive: res.ok || res.type === 'opaque', lastChecked: Date.now() };
    } catch (err) {
      clearTimeout(timeout);
      state.peerStatus[key] = { isActive: false, lastChecked: Date.now() };
    }
  }
  renderPeers();
  renderSavedPeers();
}

// Renderizar dispositivos guardados
function renderSavedPeers() {
  const container = document.getElementById('saved-peers-container');
  const section = document.getElementById('saved-peers-section');

  // Mostrar solo los savedPeers que NO están en la lista de descubiertos
  const unsyncedSaved = state.savedPeers.filter(
    saved => !state.peers.some(p => p.ip === saved.ip && p.port === saved.port)
  );

  if (unsyncedSaved.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  let html = '';
  unsyncedSaved.forEach(peer => {
    const isSelected = state.selectedPeer && state.selectedPeer.ip === peer.ip && state.selectedPeer.port === peer.port;
    const peerKey = `${peer.ip}:${peer.port}`;
    const peerStatus = state.peerStatus[peerKey];
    const isOnline = peerStatus?.isActive || false;

    html += `
      <div class="peer-item ${isSelected ? 'active' : ''}" onclick="selectPeer('${peer.ip}', ${peer.port})">
        <div class="peer-item__info">
          <div class="peer-item__icon-wrapper">
            <i data-lucide="${peer.os === 'Windows' ? 'monitor-smartphone' : 'monitor-smartphone'}"></i>
          </div>
          <div class="peer-item__details">
            <span class="peer-item__name">${peer.hostname}</span>
            <span class="peer-item__ip">${peer.ip}:${peer.port}</span>
          </div>
        </div>
        <div class="peer-item__meta">
          <span class="peer-item__os-badge">${peer.os}</span>
          <span class="peer-item__status-dot ${isOnline ? 'online' : 'offline'}"></span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();
}

// Polling de archivos recibidos
async function fetchFiles() {
  try {
    const res = await fetch(`${API_BASE}/api/files`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.files = data.files;
    renderFiles();
  } catch (err) {
    console.error('Error al obtener archivos:', err);
  }
}

// Renderizar archivos recibidos
function renderFiles() {
  const container = document.getElementById('files-container');
  if (state.files.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="empty-state__icon" data-lucide="hard-drive"></i>
        <p>No se recibieron archivos todavía.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let html = '';
  state.files.forEach(file => {
    const icon = file.isDirectory ? 'folder' : 'file';
    html += `
      <div class="file-item">
        <div class="file-item__info">
          <div class="file-item__icon-wrapper">
            <i data-lucide="${icon}"></i>
          </div>
          <div class="file-item__text">
            <span class="file-item__name" title="${file.name}">${file.name}</span>
            <span class="file-item__meta">${formatSize(file.size)} · ${timeAgo(file.modifiedAt)}</span>
          </div>
        </div>
        <div class="file-item__actions">
          <button class="action-btn download" onclick="downloadFile('${file.name}')" title="Descargar">
            <i data-lucide="download"></i>
          </button>
          <button class="action-btn delete" onclick="deleteFile('${file.name}')" title="Eliminar">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();
}

// --- Transferencias ENTRANTES (avisos del lado que recibe) ---

async function fetchIncoming() {
  try {
    const res = await fetch(`${API_BASE}/api/incoming`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    handleIncomingUpdate(data.incoming || []);
  } catch (err) {
    // Silencioso: el server puede estar reiniciando
  }
}

function handleIncomingUpdate(list) {
  // Detectar nuevos y completados para avisar con toast
  list.forEach(info => {
    const prev = state.incoming[info.uploadId];
    if (!prev && info.status === 'receiving') {
      const origen = info.fromIp ? ` desde ${info.fromIp}` : '';
      showToast(`Recibiendo: ${info.name}${origen}`, 'info');
    }
    if (info.status === 'completed' && (!prev || prev.status !== 'completed')) {
      showToast(`✓ Recibido: ${info.name}`, 'success');
      fetchFiles(); // refrescar la lista de archivos ya
    }
    if (info.status === 'error' && (!prev || prev.status !== 'error')) {
      showToast(`Error recibiendo: ${info.name}`, 'error');
    }
    if (info.status === 'cancelled' && (!prev || prev.status !== 'cancelled')) {
      showToast(`Transferencia cancelada por el emisor: ${info.name}`, 'warning');
    }
    state.incoming[info.uploadId] = info;
  });

  // Limpiar del estado los que ya no vienen
  const liveIds = new Set(list.map(i => i.uploadId));
  Object.keys(state.incoming).forEach(id => {
    if (!liveIds.has(id)) delete state.incoming[id];
  });

  renderIncoming(list);
}

function renderIncoming(list) {
  const section = document.getElementById('incoming-section');
  const container = document.getElementById('incoming-list');
  const active = list.filter(i => i.status === 'receiving');

  if (active.length === 0) {
    section.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  let html = '';
  active.forEach(info => {
    const percent = info.totalSize > 0
      ? Math.min(100, Math.round((info.receivedBytes / info.totalSize) * 100))
      : 0;
    const icon = info.isFolder ? 'folder' : 'file';
    const origen = info.fromIp ? ` · desde ${info.fromIp}` : '';
    html += `
      <div class="transfer-item">
        <div class="transfer-item__header">
          <div class="transfer-item__title-wrapper">
            <i data-lucide="${icon}"></i>
            <span class="transfer-item__name" title="${info.name}">${info.name}</span>
          </div>
          <span class="transfer-item__meta">${formatSize(info.receivedBytes)} / ${formatSize(info.totalSize)}</span>
        </div>
        <div class="transfer-item__progress-wrapper">
          <div class="transfer-item__bar-container">
            <div class="transfer-item__bar" style="width: ${percent}%"></div>
          </div>
          <span class="transfer-item__percent">${percent}%</span>
        </div>
        <span class="transfer-item__status" style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; display: block;">Recibiendo${origen}</span>
      </div>
    `;
  });
  container.innerHTML = html;
  lucide.createIcons();
}

// Descargar archivo/carpeta
window.downloadFile = function(name) {
  window.open(`${API_BASE}/api/files/${encodeURIComponent(name)}`, '_blank');
};

// Eliminar archivo/carpeta
window.deleteFile = async function(name) {
  const confirmed = confirm(`¿Estás seguro de que querés eliminar "${name}"?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/api/files/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast('Archivo eliminado', 'success');
      fetchFiles();
    } else {
      showToast('No se pudo eliminar el archivo', 'error');
    }
  } catch (err) {
    showToast('Error al eliminar', 'error');
  }
};

// --- Manejo del Drop y Envío de archivos ---

async function handleDrop(e) {
  if (!state.selectedPeer) {
    showToast('Seleccioná un dispositivo de destino primero', 'warning');
    return;
  }

  const items = e.dataTransfer.items;
  if (!items || items.length === 0) return;

  // Evaluar si es un drag de archivo o carpeta
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry();
    if (entry) {
      entries.push(entry);
    }
  }

  if (entries.length === 0) return;

  for (const entry of entries) {
    if (entry.isFile) {
      // Es un archivo individual
      entry.file((file) => {
        uploadFiles([file], state.selectedPeer);
      });
    } else if (entry.isDirectory) {
      // Es un directorio completo
      uploadFolder(entry, state.selectedPeer);
    }
  }
}

// Manejo al seleccionar archivos individuales desde el botón/explorador
function handleSelectedFiles(files) {
  if (!state.selectedPeer) {
    showToast('Seleccioná un dispositivo de destino primero', 'warning');
    return;
  }
  uploadFiles(files, state.selectedPeer);
}

// Manejo al seleccionar una carpeta desde el botón/explorador
async function handleSelectedFolderFiles(fileList) {
  if (!state.selectedPeer) {
    showToast('Seleccioná un dispositivo de destino primero', 'warning');
    return;
  }

  // De la lista de archivos, el nombre de la carpeta raíz lo obtenemos de la ruta relativa del primer archivo
  // file.webkitRelativePath tiene formato "nombre_carpeta/subcarpeta/archivo.txt"
  const filesArray = Array.from(fileList);
  if (filesArray.length === 0) return;

  const firstPath = filesArray[0].webkitRelativePath;
  const rootFolderName = firstPath.split('/')[0];

  uploadFolderFromInput(rootFolderName, filesArray, state.selectedPeer);
}

// Recursión para leer un directorio de drag & drop
async function readDirectoryEntry(entry) {
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(f => resolve([{ file: f, relativePath: entry.fullPath }]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await readAllEntries(reader);
    const results = [];
    for (const childEntry of entries) {
      const childResults = await readDirectoryEntry(childEntry);
      results.push(...childResults);
    }
    return results;
  }
  return [];
}

function readAllEntries(reader) {
  const allEntries = [];
  return new Promise(resolve => {
    const read = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(allEntries);
        } else {
          allEntries.push(...entries);
          read();
        }
      }, () => resolve(allEntries));
    };
    read();
  });
}

// Subir lista de archivos individuales (cada uno por el uploader robusto)
function uploadFiles(files, targetPeer) {
  const container = document.getElementById('transfer-list-container');
  container.classList.remove('hidden');

  files.forEach(file => {
    const transferId = generateId();
    addTransferToUI(transferId, file.name, file.size, false);
    // file.lastModified ayuda a generar un id estable para reanudar
    const uploadId = makeUploadId(file.name, file.size, file.lastModified || 0);
    robustUpload(transferId, file, file.size, {
      uploadId,
      targetPeer,
      isFolder: false,
      fileName: file.name,
      displayName: file.name
    });
  });
}

// Subir carpeta tirada por Drag & Drop
async function uploadFolder(folderEntry, targetPeer) {
  const transferId = generateId();
  const folderName = folderEntry.name;
  
  addTransferToUI(transferId, `${folderName}/ (Comprimiendo)`, 0, true);

  try {
    // Leer todos los archivos recursivamente
    const items = await readDirectoryEntry(folderEntry);
    
    if (items.length === 0) {
      showToast('La carpeta está vacía', 'warning');
      removeTransferFromUI(transferId);
      return;
    }

    // Calcular tamaño total
    let totalSize = items.reduce((sum, item) => sum + item.file.size, 0);
    updateTransferDetails(transferId, `${folderName}/`, totalSize);

    // Comprimir usando JSZip
    const zip = new JSZip();
    items.forEach(item => {
      // relativePath tiene la forma "/nombre_carpeta/sub/archivo.txt", quitamos la barra inicial
      const cleanPath = item.relativePath.startsWith('/') ? item.relativePath.substring(1) : item.relativePath;
      // Quitamos la carpeta raíz del path dentro del zip para que el server lo descomprima ordenadamente en su destino
      const pathParts = cleanPath.split('/');
      pathParts.shift(); // Quitar nombre carpeta raíz
      const zipPath = pathParts.join('/');
      
      zip.file(zipPath, item.file);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      // metadata.percent da el progreso de compresión local
      const compPercent = Math.round(metadata.percent);
      updateTransferStatusText(transferId, `Comprimiendo: ${compPercent}%`);
    });

    updateTransferStatusText(transferId, 'Enviando');
    sendFolderZip(transferId, folderName, zipBlob, targetPeer);

  } catch (err) {
    console.error(err);
    markTransferError(transferId);
    showToast(`Error al procesar carpeta: ${folderName}`, 'error');
  }
}

// Subir carpeta seleccionada vía explorador de archivos
async function uploadFolderFromInput(folderName, filesArray, targetPeer) {
  const transferId = generateId();
  addTransferToUI(transferId, `${folderName}/ (Comprimiendo)`, 0, true);

  try {
    let totalSize = filesArray.reduce((sum, f) => sum + f.size, 0);
    updateTransferDetails(transferId, `${folderName}/`, totalSize);

    const zip = new JSZip();
    filesArray.forEach(file => {
      // file.webkitRelativePath tiene formato "nombre_carpeta/subcarpeta/archivo.txt"
      const pathParts = file.webkitRelativePath.split('/');
      pathParts.shift(); // Quitamos carpeta raíz para subir contenido directo a descomprimir
      const zipPath = pathParts.join('/');
      
      zip.file(zipPath, file);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      const compPercent = Math.round(metadata.percent);
      updateTransferStatusText(transferId, `Comprimiendo: ${compPercent}%`);
    });

    updateTransferStatusText(transferId, 'Enviando');
    sendFolderZip(transferId, folderName, zipBlob, targetPeer);

  } catch (err) {
    console.error(err);
    markTransferError(transferId);
    showToast(`Error al procesar carpeta: ${folderName}`, 'error');
  }
}

// Enviar el Blob Zip de la carpeta al remoto (por el uploader robusto)
function sendFolderZip(transferId, folderName, zipBlob, targetPeer) {
  const container = document.getElementById('transfer-list-container');
  container.classList.remove('hidden');

  // Id estable por nombre+tamaño del zip generado (permite reanudar)
  const uploadId = makeUploadId(`folder:${folderName}`, zipBlob.size, 0);
  robustUpload(transferId, zipBlob, zipBlob.size, {
    uploadId,
    targetPeer,
    isFolder: true,
    folderName,
    displayName: `${folderName}/`
  });
}

// ============================================================================
//  UPLOADER ROBUSTO POR CHUNKS
//  - Parte el archivo en trozos.
//  - Verifica cada trozo con SHA-256 (integridad: no se pierde nada).
//  - Reintenta infinito con backoff ante cualquier error de red.
//  - Reanuda preguntando al receptor qué trozos ya tiene.
// ============================================================================

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB por trozo
const MAX_BACKOFF = 15000;          // tope de espera entre reintentos (ms)

// Transferencias de subida activas (para poder cancelarlas)
// transferId -> { uploadId, targetPeer, controller, cancelled }
const activeTransfers = {};

class CancelledError extends Error {
  constructor() { super('cancelled'); this.code = 'CANCELLED'; }
}

// Cancelar una transferencia en curso desde el botón de la UI
window.cancelTransfer = async function(transferId) {
  const t = activeTransfers[transferId];
  if (!t) return;
  t.cancelled = true;
  try { t.controller.abort(); } catch (_) {}

  // Avisar al receptor para que limpie el .part
  try {
    await fetch(`http://${t.targetPeer.ip}:${t.targetPeer.port}/api/upload/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: t.uploadId })
    });
  } catch (_) {}

  markTransferCancelled(transferId);
  showToast('Transferencia cancelada', 'warning');
};

function makeUploadId(name, size, lastModified) {
  // Id determinístico y seguro para URL a partir de los datos del archivo
  const raw = `${name}|${size}|${lastModified}`;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h1 ^= raw.charCodeAt(i);
    h1 = (h1 * 0x01000193) >>> 0;
  }
  return 'u' + h1.toString(16) + size.toString(36);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function chunkHeaders(hash) {
  const h = { 'Content-Type': 'application/octet-stream' };
  if (hash) h['x-chunk-sha256'] = hash;
  return h;
}

// Hash SHA-256 de un trozo. Devuelve null si Web Crypto no está disponible
// (p. ej. la página se abrió por IP en vez de localhost = contexto no seguro).
// En ese caso el server igual valida el tamaño total al finalizar.
const HAS_SUBTLE = typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function';

async function sha256Hex(arrayBuffer) {
  if (!HAS_SUBTLE) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  } catch (e) {
    return null;
  }
}

// POST con reintentos infinitos. Devuelve la respuesta; lanza solo en errores
// "definitivos" (status que pide reiniciar la sesión: 410).
async function postWithRetry(transferId, url, fetchOpts, onAttempt) {
  let attempt = 0;
  const t = activeTransfers[transferId];
  while (true) {
    if (t && t.cancelled) throw new CancelledError();
    attempt++;
    try {
      if (onAttempt) onAttempt(attempt);
      const opts = t ? { ...fetchOpts, signal: t.controller.signal } : fetchOpts;
      const res = await fetch(url, opts);
      if (res.status === 410) {
        // Sesión perdida en el server: hay que re-init desde cero
        const e = new Error('session-lost');
        e.code = 'SESSION_LOST';
        throw e;
      }
      if (!res.ok && res.status !== 409 && res.status !== 422) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      if (err.code === 'SESSION_LOST') throw err;
      // Si fue una cancelación del usuario, no reintentamos
      if (err.code === 'CANCELLED' || err.name === 'AbortError' || (t && t.cancelled)) {
        throw new CancelledError();
      }
      // Error de red o server caído: esperamos y reintentamos sin rendirnos
      const backoff = Math.min(MAX_BACKOFF, 800 * Math.pow(2, Math.min(attempt - 1, 5)));
      updateTransferStatusText(transferId, `Conexión caída — reintentando (intento ${attempt})…`);
      await sleep(backoff);
    }
  }
}

async function robustUpload(transferId, blob, totalSize, opts) {
  const { uploadId, targetPeer, isFolder } = opts;
  const base = `http://${targetPeer.ip}:${targetPeer.port}`;
  const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));

  // Registrar para poder cancelar (reusar controller si es un re-arranque)
  if (!activeTransfers[transferId]) {
    activeTransfers[transferId] = { uploadId, targetPeer, controller: new AbortController(), cancelled: false };
  }

  try {
    // --- 1. INIT (con reanudación) ---
    updateTransferStatusText(transferId, 'Conectando…');
    let received = new Set();

    const doInit = async () => {
      const res = await postWithRetry(transferId, `${base}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          fileName: opts.fileName || opts.displayName,
          folderName: opts.folderName || null,
          isFolder: !!isFolder,
          totalSize,
          totalChunks,
          chunkSize: CHUNK_SIZE
        })
      });
      const data = await res.json();
      return new Set(data.received || []);
    };

    received = await doInit();

    if (received.size > 0) {
      updateTransferStatusText(transferId, `Reanudando (${received.size}/${totalChunks} trozos ya enviados)…`);
    }

    // --- 2. ENVIAR CHUNKS (secuencial, con verificación + reintentos) ---
    let sentBytes = received.size * CHUNK_SIZE; // aproximado para el progreso inicial
    if (sentBytes > totalSize) sentBytes = totalSize;
    updateTransferProgress(transferId, Math.round((sentBytes / totalSize) * 100));

    for (let i = 0; i < totalChunks; i++) {
      if (received.has(i)) continue;

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const slice = blob.slice(start, end);
      const buffer = await slice.arrayBuffer();
      const hash = await sha256Hex(buffer);

      try {
        const res = await postWithRetry(
          transferId,
          `${base}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
          { method: 'POST', headers: chunkHeaders(hash), body: buffer }
        );

        if (res.status === 422) {
          // El server detectó hash distinto: reintentamos este mismo trozo
          i--;
          continue;
        }

        received.add(i);
        sentBytes = Math.min(totalSize, sentBytes + (end - start));
        const percent = Math.round((sentBytes / totalSize) * 100);
        updateTransferProgress(transferId, percent);
        updateTransferStatusText(transferId, `Enviando… ${percent}%`);
      } catch (err) {
        if (err.code === 'SESSION_LOST') {
          // El server reinició: re-init y volvemos a calcular qué falta
          updateTransferStatusText(transferId, 'Reconectando sesión…');
          received = await doInit();
          i = -1; // reiniciar el barrido; los chunks ya presentes se saltean
          continue;
        }
        throw err;
      }
    }

    // --- 3. COMPLETE (valida tamaño total en el receptor) ---
    updateTransferStatusText(transferId, 'Verificando integridad…');
    while (true) {
      const res = await postWithRetry(transferId, `${base}/api/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
      }, null);

      if (res.status === 409) {
        // Faltan chunks (raro): los reenviamos
        const data = await res.json().catch(() => ({ missing: [] }));
        const missing = data.missing || [];
        updateTransferStatusText(transferId, `Reenviando ${missing.length} trozo(s) faltante(s)…`);
        for (const i of missing) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, totalSize);
          const buffer = await blob.slice(start, end).arrayBuffer();
          const hash = await sha256Hex(buffer);
          await postWithRetry(
            transferId,
            `${base}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
            { method: 'POST', headers: chunkHeaders(hash), body: buffer }
          );
        }
        continue;
      }

      if (res.status === 422) {
        // Tamaño no coincide: rarísimo. Reintentamos complete.
        updateTransferStatusText(transferId, 'Revalidando…');
        await sleep(1000);
        continue;
      }

      if (!res.ok) throw new Error(`complete HTTP ${res.status}`);

      const data = await res.json();
      delete activeTransfers[transferId];
      markTransferComplete(transferId);
      showToast(`${isFolder ? 'Carpeta enviada' : 'Archivo enviado'}: ${data.name || opts.displayName}`, 'success');
      return;
    }
  } catch (err) {
    if (err.code === 'CANCELLED') {
      // El usuario canceló: la UI ya quedó marcada, solo limpiamos
      delete activeTransfers[transferId];
      return;
    }
    if (err.code === 'SESSION_LOST') {
      // Reintento global: re-arrancamos la subida completa una vez más
      updateTransferStatusText(transferId, 'Reiniciando transferencia…');
      await sleep(1500);
      return robustUpload(transferId, blob, totalSize, opts);
    }
    delete activeTransfers[transferId];
    console.error('[robustUpload]', err);
    markTransferError(transferId);
    showToast(`Error al enviar: ${opts.displayName}`, 'error');
  }
}

// --- Gestión de la UI de Transferencias ---

function addTransferToUI(id, name, size, isFolder) {
  const list = document.getElementById('transfer-list');
  const icon = isFolder ? 'folder' : 'file';
  
  const html = `
    <div class="transfer-item" id="t-${id}">
      <div class="transfer-item__header">
        <div class="transfer-item__title-wrapper">
          <i data-lucide="${icon}"></i>
          <span class="transfer-item__name" title="${name}">${name}</span>
        </div>
        <div class="transfer-item__header-right">
          <span class="transfer-item__meta" id="t-meta-${id}">${formatSize(size)}</span>
          <button class="transfer-item__cancel" id="t-cancel-${id}" title="Cancelar" onclick="cancelTransfer('${id}')">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="transfer-item__progress-wrapper">
        <div class="transfer-item__bar-container">
          <div class="transfer-item__bar" id="t-bar-${id}"></div>
        </div>
        <span class="transfer-item__percent" id="t-percent-${id}">0%</span>
      </div>
      <span class="transfer-item__status" id="t-status-${id}" style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; display: block;">En cola</span>
    </div>
  `;

  list.insertAdjacentHTML('beforeend', html);
  lucide.createIcons();
}

function updateTransferProgress(id, percent) {
  const bar = document.getElementById(`t-bar-${id}`);
  const percentText = document.getElementById(`t-percent-${id}`);
  const statusText = document.getElementById(`t-status-${id}`);
  
  if (bar) bar.style.width = `${percent}%`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (statusText) statusText.textContent = 'Enviando';
}

function updateTransferDetails(id, cleanName, size) {
  const nameEl = document.querySelector(`#t-${id} .transfer-item__name`);
  const metaEl = document.getElementById(`t-meta-${id}`);
  if (nameEl) nameEl.textContent = cleanName;
  if (metaEl) metaEl.textContent = formatSize(size);
}

function updateTransferStatusText(id, text) {
  const el = document.getElementById(`t-status-${id}`);
  if (el) el.textContent = text;
}

function hideCancelButton(id) {
  const btn = document.getElementById(`t-cancel-${id}`);
  if (btn) btn.remove();
}

function markTransferComplete(id) {
  const item = document.getElementById(`t-${id}`);
  const statusText = document.getElementById(`t-status-${id}`);
  const percentText = document.getElementById(`t-percent-${id}`);

  if (item) item.classList.add('complete');
  if (statusText) statusText.textContent = 'Completado';
  if (percentText) percentText.textContent = '✓';
  hideCancelButton(id);

  // Limpiar del UI a los 6 segundos
  setTimeout(() => {
    if (item) item.remove();
    checkTransferContainerEmpty();
  }, 6000);
}

function markTransferError(id) {
  const item = document.getElementById(`t-${id}`);
  const statusText = document.getElementById(`t-status-${id}`);
  const percentText = document.getElementById(`t-percent-${id}`);

  if (item) item.classList.add('error');
  if (statusText) statusText.textContent = 'Error';
  if (percentText) percentText.textContent = '✗';
  hideCancelButton(id);
}

function markTransferCancelled(id) {
  const item = document.getElementById(`t-${id}`);
  const statusText = document.getElementById(`t-status-${id}`);
  const percentText = document.getElementById(`t-percent-${id}`);

  if (item) item.classList.add('error');
  if (statusText) statusText.textContent = 'Cancelada';
  if (percentText) percentText.textContent = '✗';
  hideCancelButton(id);

  setTimeout(() => {
    if (item) item.remove();
    checkTransferContainerEmpty();
  }, 4000);
}

function removeTransferFromUI(id) {
  const item = document.getElementById(`t-${id}`);
  if (item) item.remove();
  checkTransferContainerEmpty();
}

function checkTransferContainerEmpty() {
  const list = document.getElementById('transfer-list');
  const container = document.getElementById('transfer-list-container');
  if (list.children.length === 0) {
    container.classList.add('hidden');
  }
}

// --- Utilidades ---

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(isoString) {
  const now = new Date();
  const date = new Date(isoString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 10) return 'Ahora';
  if (seconds < 60) return `Hace ${seconds} seg`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;

  const days = Math.floor(hours / 24);
  return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Mostrar notificaciones Toast
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toastId = generateId();
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'x-circle';
  if (type === 'warning') iconName = 'x-circle';

  const html = `
    <div class="toast ${type}" id="toast-${toastId}">
      <div class="toast__content">
        <i class="toast__icon" data-lucide="${iconName}"></i>
        <span class="toast__text">${message}</span>
      </div>
      <button class="toast__close" onclick="document.getElementById('toast-${toastId}').remove()">
        <i data-lucide="x"></i>
      </button>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', html);
  lucide.createIcons();

  // Auto-eliminar
  setTimeout(() => {
    const el = document.getElementById(`toast-${toastId}`);
    if (el) el.remove();
  }, 4000);
}
