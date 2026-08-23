const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const jsFiles = ['script-index.js', 'script-stream.js'];

jsFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`[INFO] Memproses JS obfuscation untuk ${file}...`);
        const code = fs.readFileSync(file, 'utf8');
        const obfuscated = JavaScriptObfuscator.obfuscate(code, {
            compact: true,
            controlFlowFlattening: false,
            simplify: true,
            stringArray: true,
            stringArrayThreshold: 0.75
        }).getObfuscatedCode();
        
        fs.writeFileSync(file, obfuscated, 'utf8');
        console.log(`[SUKSES] ${file} selesai di-obfuscate.`);
    }
});

const htmlFiles = ['index.html', 'stream.html'];

htmlFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`[INFO] Memproses enkripsi total untuk ${file}...`);
        const rawHtml = fs.readFileSync(file, 'utf8');
        
        const base64Html = Buffer.from(rawHtml).toString('base64');
        
        const encryptedWrapper = `<!DOCTYPE html><html><head><meta charset="UTF-8"><script type="text/javascript">document.write(decodeURIComponent(escape(atob("${base64Html}"))));</script></head><body></body></html>`;
        
        fs.writeFileSync(file, encryptedWrapper, 'utf8');
        console.log(`[SUKSES] ${file} berhasil dienkripsi total.`);
    }
});
