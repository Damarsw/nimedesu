const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify } = require('html-minifier-terser');

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

async function processHtmlFiles() {
    for (const file of htmlFiles) {
        if (fs.existsSync(file)) {
            console.log(`[INFO] Memproses minify & obfuscate untuk ${file}...`);
            const htmlContent = fs.readFileSync(file, 'utf8');
            
            try {
                const minifiedHtml = await minify(htmlContent, {
                    collapseWhitespace: true,
                    removeComments: true,
                    removeRedundantAttributes: true,
                    removeScriptTypeAttributes: true,
                    removeStyleLinkTypeAttributes: true,
                    useShortDoctype: true,
                    minifyJS: true,
                    minifyCSS: true 
                });

                fs.writeFileSync(file, minifiedHtml, 'utf8');
                console.log(`[SUKSES] ${file} berhasil di-minify.`);
            } catch (err) {
                console.error(`[ERROR] Gagal memproses ${file}:`, err);
            }
        }
    }
}

processHtmlFiles();
