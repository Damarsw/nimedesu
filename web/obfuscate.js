const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const jsFiles = [
    'assets/js/core-utils.js',
    'assets/js/account.js',
    'assets/js/app-render.js'
];

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
        console.log(`[INFO] Memeriksa import script pada ${file}...`);
    }
});
