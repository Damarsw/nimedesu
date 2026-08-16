const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const filesToProcess = ['script-index.js', 'script-stream.js'];

filesToProcess.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`[INFO] Memproses obfuscation untuk ${file}...`);
        const code = fs.readFileSync(file, 'utf8');
        
        const obfuscatedCode = JavaScriptObfuscator.obfuscate(code, {
            compact: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            debugProtection: false,
            disableConsoleOutput: false,
            identifierNamesGenerator: 'hexadecimal',
            log: false,
            numbersToExpressions: false,
            renameGlobals: false,
            selfDefending: false,
            simplify: true,
            splitStrings: false,
            stringArray: true,
            stringArrayCallsTransform: true,
            stringArrayEncoding: [],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 1,
            stringArrayWrappersChainedCalls: true,
            stringArrayWrappersParametersMaxCount: 2,
            stringArrayWrappersType: 'variable',
            stringArrayThreshold: 0.75,
            unicodeEscapeSequence: false
        }).getObfuscatedCode();

        fs.writeFileSync(file, obfuscatedCode, 'utf8');
        console.log(`[SUKSES] ${file} berhasil di-obfuscate.`);
    } else {
        console.log(`[SKIP] File ${file} tidak ditemukan, melanjutkan build...`);
    }
});
