const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(() => {
  const candidates = [
    path.join(process.cwd(), 'build/icon.ico'),
    path.join(process.cwd(), 'build/icons/icon.ico'),
    path.join(process.cwd(), 'build/icons/icon-256.png'),
    path.join(process.cwd(), 'public/brand/subagents-icon-64.png'),
  ];
  for (const p of candidates) {
    const exists = fs.existsSync(p);
    let empty = true, size = null;
    if (exists) {
      const img = nativeImage.createFromPath(p);
      empty = img.isEmpty();
      size = empty ? null : img.getSize();
    }
    console.log(JSON.stringify({ p, exists, empty, size }));
  }
  app.quit();
});
