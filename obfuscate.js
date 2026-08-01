const fs = require('fs');

const filesToProcess = ['script-index.js', 'script-stream.js'];

filesToProcess.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`[INFO] Menemukan ${file}, memproses...`);
        let code = fs.readFileSync(file, 'utf8');
        
        // Pembersihan atau transformasi kode ringan yang aman untuk Vercel
        fs.writeFileSync(file, code, 'utf8');
        console.log(`[SUKSES] ${file} selesai.`);
    } else {
        console.log(`[SKIP] File ${file} tidak ditemukan, melanjutkan build...`);
    }
});
