const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

async function processFiles() {
    const filesToProcess = ['script-index.js', 'script-stream.js'];

    for (const file of filesToProcess) {
        if (fs.existsSync(file)) {
            console.log(`[INFO] Memproses dan mengamankan ${file}...`);
            const code = fs.readFileSync(file, 'utf8');

            const result = await minify(code, {
                compress: {
                    drop_console: false, // Ubah jadi true jika ingin menghapus console.log
                },
                mangle: {
                    toplevel: true,
                },
            });

            if (result.code) {
                fs.writeFileSync(file, result.code, 'utf8');
                console.log(`[SUKSES] ${file} berhasil diamankan.`);
            }
        } else {
            console.log(`[WARNING] File ${file} tidak ditemukan, melewati...`);
        }
    }
}

processFiles();
