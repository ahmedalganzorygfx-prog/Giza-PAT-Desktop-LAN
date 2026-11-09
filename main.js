'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { startServer } = require('./server');
let mainWindow, serverHandle, config;
const defaultConfig = { serverUrl: 'http://127.0.0.1:8765', isServer: true, port: 8765, token: crypto.randomBytes(32).toString('hex') };
const dataDir = () => path.join(app.getPath('userData'), 'data');
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { config = { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath(),'utf8')) }; }
  catch { config = { ...defaultConfig }; }
  return config;
}
function writeConfig(next) {
  config = { ...defaultConfig, ...next };
  fs.mkdirSync(path.dirname(configPath()), {recursive:true});
  fs.writeFileSync(configPath(), JSON.stringify(config,null,2), 'utf8');
}
function startCentralService() {
  if (!config.isServer || serverHandle) return;
  serverHandle = startServer({ dataDir: dataDir(), port: config.port, token: config.token });
}
function createWindow(file='index.html') {
  mainWindow = new BrowserWindow({ width: 1440, height: 940, minWidth: 1024, minHeight: 700,
    title: 'Giza PAT System - الأكاديمية المهنية للمعلمين فرع الجيزة',
    autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname,file));
  mainWindow.on('closed',()=>mainWindow=null);
}
app.whenReady().then(() => {
  readConfig();
  if (!fs.existsSync(configPath())) { createWindow('setup.html'); return; }
  startCentralService(); createWindow();
  const template = [
    {label:'ملف',submenu:[{label:'فتح مجلد البيانات',click:()=>shell.openPath(dataDir())},{type:'separator'},{role:'quit',label:'خروج'}]},
    {label:'إدارة',submenu:[{label:'إعداد اتصال الشبكة',click:()=>createWindow('setup.html')},{label:'نسخة احتياطية الآن',accelerator:'Ctrl+Shift+B',click:()=>mainWindow?.webContents.send('backup-request')}]},
    {label:'عرض',submenu:[{role:'reload',label:'إعادة تحميل'},{role:'togglefullscreen',label:'ملء الشاشة'},{role:'toggledevtools',label:'أدوات المطور'}]},
    {label:'مساعدة',submenu:[{label:'حول البرنامج',click:()=>dialog.showMessageBox({message:'Giza PAT System\nالإصدار المكتبي 1.0.0\nفرع الأكاديمية المهنية للمعلمين بالجيزة'})}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0) createWindow();});
});
app.on('before-quit',()=>{try{serverHandle?.close();}catch{}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin') app.quit();});

ipcMain.on('get-config-sync',(event)=>{event.returnValue={...config, dataDir:dataDir()};});
ipcMain.handle('save-config', async (_event,next)=>{writeConfig(next); return {ok:true};});
ipcMain.handle('restart-app',()=>{app.relaunch();app.exit(0);});
ipcMain.handle('export-backup',async (_event,data)=>{
  const folder=path.join(dataDir(),'backups'); fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,`Giza_PAT_Backup_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8'); return {success:true,path:file};
});
ipcMain.handle('save-backup',async (_event,data)=>{
  try {const folder=path.join(dataDir(),'backups');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'latest-backup.json');fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8');return {success:true,path:file};}
  catch(e){return {success:false,error:e.message};}
});
ipcMain.handle('load-backup',async()=>{
  const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'JSON Backup',extensions:['json']}]});
  if(result.canceled||!result.filePaths[0]) return {success:false};
  try{return {success:true,data:JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'))};}catch(e){return {success:false,error:e.message};}
});
ipcMain.handle('open-data-dir',()=>{fs.mkdirSync(dataDir(),{recursive:true});return shell.openPath(dataDir());});
ipcMain.handle('get-health',async()=>{
  try {const url=new URL('/api/health',config.serverUrl);const response=await fetch(url);return await response.json();}catch(e){return {ok:false,error:e.message};}
});
