# LocalDrop 🚀

Aplicación web liviana y moderna para transferir archivos y carpetas completas entre equipos de la misma red local (ej: Windows 11 ↔ Arch Linux). Posee detección automática de dispositivos y una interfaz premium basada en la estética **Kaisse**.

---

## 🛠️ Requisitos Previos

Necesitás tener instalado **Node.js** en ambas máquinas.

### En Windows 11:
1. Descargá el instalador oficial desde [nodejs.org](https://nodejs.org/).
2. Asegurate de marcar la casilla para agregar `node` y `npm` al PATH del sistema durante la instalación.

### En Arch Linux:
Instalalo desde la terminal usando pacman:
```bash
sudo pacman -S nodejs npm
```

---

## 🚀 Instalación y Uso Rápido

1. Copiá la carpeta de este proyecto a ambos equipos.
2. Abrí una terminal en la carpeta del proyecto en cada máquina y ejecutá:
   ```bash
   npm install
   ```
3. Iniciá el servidor en ambas máquinas:
   ```bash
   npm start
   ```
4. Abrí tu navegador en cualquiera de las máquinas e ingresá a:
   ```
   http://localhost:7749
   ```

*¡Listo! Los equipos se detectarán automáticamente y podrás arrastrar archivos o carpetas directo a la zona de envío.*

---

## 📁 Estructura de Carpetas

Los archivos o carpetas que recibas se guardarán automáticamente en un directorio llamado **`Recibidos/`** que se creará dentro de la misma carpeta donde está alojado este script.

---

## 🔒 Configuración de Firewall (Solución de problemas)

Si los dispositivos no se detectan automáticamente o las descargas fallan, suele deberse al firewall del sistema operativo. Asegurate de habilitar el tráfico de los siguientes puertos:

* **Puerto `7749` (TCP)**: Utilizado para la interfaz web y la transferencia de archivos.
* **Puerto `7750` (UDP)**: Utilizado para el auto-descubrimiento en la red local.

### En Windows 11:
La primera vez que ejecutes `npm start`, Windows te mostrará una alerta de seguridad preguntándote si deseás permitir que Node.js se comunique en redes privadas. Asegurate de **marcar la casilla de redes privadas** y dar acceso.

### En Arch Linux (si usás UFW):
Habilitá los puertos ejecutando en tu terminal:
```bash
sudo ufw allow 7749/tcp
sudo ufw allow 7750/udp
sudo ufw reload
```

---

## 💡 Fallback Manual
Si por restricciones de tu router o red local el auto-descubrimiento por UDP no funciona, podés agregar el dispositivo remoto de forma manual haciendo click en **"Agregar IP manualmente"** en la interfaz e ingresando su dirección IP local (ej. `192.168.1.45`).
