const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// Daftar file JavaScript frontend yang akan diproses otomatis saat build
const filesToProcess = ['script-index.js', 'script-stream.js'];

filesToProcess.forEach(fileName => {
    const filePath = path.join(__dirname, fileName);
    
    if (fs.existsSync(filePath)) {
        const code = fs.readFileSync(filePath, 'utf8');
        
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
            compact: true, // Minifikasi total (menghapus spasi dan baris baru)
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            identifierNamesGenerator: 'dictionary', // Mangling variabel menjadi huruf pendek
            identifiersDictionary: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'],
            renameGlobals: false,
            selfDefending: true,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75
        });

        fs.writeFileSync(filePath, obfuscationResult.getObfuscatedCode(), 'utf8');
        console.log(`[SUKSES] File ${fileName} berhasil diminifikasi, di-mangle, dan diamankan!`);
    } else {
        console.log(`[INFO] File ${fileName} tidak ditemukan.`);
    }
});