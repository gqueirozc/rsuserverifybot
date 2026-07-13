async function verifyName(name) {
    try {
        const r = await fetch(
            `https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(name)}`
        );
        return r.ok;
    } catch (err) {
        console.error('verifyName error:', err);
        return false;
    }
}

module.exports = { verifyName };
