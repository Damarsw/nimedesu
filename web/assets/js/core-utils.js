(function() {
    let isBlanked = false;
    function triggerBlankScreen() {
        if (isBlanked) return;
        isBlanked = true;
        document.body.innerHTML = '';
        document.body.style.backgroundColor = '#000000';
        document.body.style.display = 'none';
        window.stop();
    }
})();

document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

function timtit() { return "timtit"; }

function hashAnilistID(rawId) {
    if (!rawId) return "";
    return CryptoJS.SHA256(String(rawId).toLowerCase().trim()).toString(CryptoJS.enc.Hex);
}

function encryptCookiesData(cookiesObj) {
    try {
        const jsonStr = JSON.stringify(cookiesObj);
        return CryptoJS.AES.encrypt(jsonStr, timtit()).toString();
    } catch (e) { return ""; }
}

function decryptCookiesData(ciphertext) {
    if (!ciphertext) return { history: [], bookmarks: [] };
    if (typeof ciphertext === 'object') return ciphertext;
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, timtit());
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedStr) return { history: [], bookmarks: [] };
        return JSON.parse(decryptedStr);
    } catch (e) { return { history: [], bookmarks: [] }; }
}

function generateSecurityToken() {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawPayload = `${timestamp}_NimeDesuSecretKey2026`;
    const token = CryptoJS.SHA256(rawPayload).toString(CryptoJS.enc.Hex);
    return { token: token, time: timestamp.toString() };
}
