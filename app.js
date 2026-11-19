// =========================================================================
// DESTINY 2 COMMAND CENTER v16.0 — Session Persistante 90 jours (OAuth Proxy)
// =========================================================================
const DEFAULT_API_KEY = "b5ca5b2b28314f6785135d45d6a5e981";
const DEFAULT_CLIENT_ID = "56923";
const OAUTH_TOKEN_URL = "https://d2-oauth-proxy.hvanhove71.workers.dev";

const BUCKET_POSTMASTER = 215593132;
const SLOTS_DESTINY = [
    { hash: 1498876634, nom: "Arme Cinétique", type: "weapon" },
    { hash: 2465295065, nom: "Arme Énergétique", type: "weapon" },
    { hash: 953998645,  nom: "Arme Puissante", type: "weapon" },
    { hash: 3448274439, nom: "Casque", type: "armor" },
    { hash: 3551918588, nom: "Gantelets", type: "armor" },
    { hash: 14239492,   nom: "Armure de Torse", type: "armor" },
    { hash: 20886954,   nom: "Armure de Jambes", type: "armor" },
    { hash: 1585787867, nom: "Objet de Classe", type: "armor" }
];
const BUCKETS_CONNUS = new Set(SLOTS_DESTINY.map(s => s.hash));
const ARMOR_SLOTS_4 = [3448274439, 3551918588, 14239492, 20886954];
const BUCKET_CLASS_ITEM = 1585787867;

const ELEMENTS_META = {
    2: { nom: "Cryo-électrique", court: "Cryo",      color: "#85c5ec" },
    3: { nom: "Solaire",         court: "Solaire",   color: "#f2721b" },
    4: { nom: "Abyssal",         court: "Abyssal",   color: "#b184c5" },
    6: { nom: "Stase",           court: "Stase",     color: "#4d88ff" },
    7: { nom: "Filobscur",       court: "Filobscur", color: "#35e366" }
};

const TAGS_CONFIG = {
    godroll: { id: 'godroll', icon: '⭐', label: 'God Roll',   bg: '#422006', border: '#ceae33' },
    keep:    { id: 'keep',    icon: '🔒', label: 'À garder',   bg: '#1c3547', border: '#7ab0d8' },
    infuse:  { id: 'infuse',  icon: '⚡', label: 'Infuser',    bg: '#382045', border: '#8b5ca3' },
    junk:    { id: 'junk',    icon: '🗑️', label: 'Démanteler', bg: '#451515', border: '#c43e3e' }
};

const STATS_ARMES_ORDRE = [
    4043523819, 1240592695, 155624089, 943549884,
    4188031367, 4284893193, 2961396640, 447667954, 3871231066
];
const STATS_BAS_MEILLEUR = new Set([2961396640, 447667954]);

const STATS_GARDIEN_6 = [
    { hash: 2996146975, nom: "Mobilité",     court: "Mob" },
    { hash: 392767087,  nom: "Résistance",   court: "Rés" },
    { hash: 1943323491, nom: "Récupération", court: "Réc" },
    { hash: 1735777505, nom: "Discipline",   court: "Dis" },
    { hash: 144602215,  nom: "Intelligence", court: "Int" },
    { hash: 4244567218, nom: "Force",        court: "For" }
];
const STATS_ARMURES_ORDRE = STATS_GARDIEN_6.map(s => s.hash);
const classesNom = { 0: 'Titan', 1: 'Chasseur', 2: 'Arcaniste' };

let ongletActif = 'loadout';
let filtreDoublonsActif = false;
let joueurInfo = null;
let persoActifId = null;
let dictGlobal = {};
let mapPersos = {};
let listeCoffre = [];
let compteDoublons = {};
let listeCrafting = [];
let listeCatalyseurs = [];
let groupesMarchands = {};
let listeQuetes = [];
let listeExotiques = [];
let listeTriomphes = [];
let registreObjets = {};
let comparateurKeys = [];
let itemTags = {};
let objetGlisse = null;
let inspecteurVerrouille = false;
let inspecteurUkeyActif = null;
let promesseRefreshEnCours = null;

const fileActions = [];
let traitementFile = false;
const busyItems = new Set();

let optState = {
    exotic: 'any',
    targets: [0, 10, 0, 10, 0, 0],
    assumeMW: true,
    useMods: true,
    ignoreJunk: true,
    results: [],
    meta: null
};

// =========================================================================
// CACHE LOCAL INDEXEDDB POUR LE MANIFEST (v15 avec DamageTypes)
// =========================================================================
function ouvrirManifestDB() {
    return new Promise((resolve) => {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open('D2CommandCenterDB', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('manifest')) db.createObjectStore('manifest');
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
    });
}

async function lireCacheManifest() {
    try {
        const db = await ouvrirManifestDB();
        if (!db) return null;
        return await new Promise((resolve) => {
            const tx = db.transaction('manifest', 'readonly');
            const req = tx.objectStore('manifest').get('fr_v15');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

async function ecrireCacheManifest(version, data) {
    try {
        const db = await ouvrirManifestDB();
        if (!db) return;
        await new Promise((resolve) => {
            const tx = db.transaction('manifest', 'readwrite');
            tx.objectStore('manifest').put({ version, data }, 'fr_v15');
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (e) { console.warn("Cache Manifest ignoré :", e); }
}

async function viderCacheManifest() {
    try {
        const db = await ouvrirManifestDB();
        if (db) {
            const tx = db.transaction('manifest', 'readwrite');
            tx.objectStore('manifest').clear();
        }
        dictGlobal = {};
        setStatus("Cache local du Manifest vidé. Clique sur 'Tout actualiser' pour recharger.");
    } catch (e) { setStatus("Impossible de vider le cache : " + e.message); }
}

async function chargerManifestAvecCache() {
    if (dictGlobal.items && dictGlobal.damageTypes) return;

    const manifestResp = await fetch('https://www.bungie.net/Platform/Destiny2/Manifest/', {
        headers: { 'X-API-Key': DEFAULT_API_KEY }
    });
    const manifestData = await manifestResp.json();
    const versionLive = manifestData.Response.version;

    const cache = await lireCacheManifest();
    if (cache && cache.version === versionLive && cache.data?.items && cache.data?.damageTypes) {
        dictGlobal = cache.data;
        setStatus("2/3 — Manifest FR chargé instantanément depuis le cache local ⚡");
        return;
    }

    setStatus("2/3 — Téléchargement du Manifest FR (mis en cache automatiquement ensuite)...");
    const fr = manifestData.Response.jsonWorldComponentContentPaths.fr;
    const [items, collectibles, records, perks, vendors, stats, nodes, milestones, objectives, activities, damageTypes] = await Promise.all([
        fetch('https://www.bungie.net' + fr.DestinyInventoryItemDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyCollectibleDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyRecordDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinySandboxPerkDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyVendorDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyStatDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyPresentationNodeDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyMilestoneDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyObjectiveDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyActivityDefinition).then(r => r.json()),
        fetch('https://www.bungie.net' + fr.DestinyDamageTypeDefinition).then(r => r.json())
    ]);
    dictGlobal = { items, collectibles, records, perks, vendors, stats, nodes, milestones, objectives, activities, damageTypes };
    ecrireCacheManifest(versionLive, dictGlobal);
}

// =========================================================================
// INITIALISATION & OAUTH PERSISTANT (CLOUDFLARE WORKER)
// =========================================================================
window.onload = async () => {
    localStorage.setItem('d2_apiKey', DEFAULT_API_KEY);
    localStorage.setItem('d2_clientId', DEFAULT_CLIENT_ID);
    chargerTagsLocale();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('bungieName')) localStorage.setItem('d2_bungieName', urlParams.get('bungieName'));
    if (localStorage.getItem('d2_bungieName')) {
        document.getElementById('bungieName').value = localStorage.getItem('d2_bungieName');
    }

    document.addEventListener('click', (e) => {
        const insp = document.getElementById('itemInspector');
        if (inspecteurVerrouille && !insp.contains(e.target) && !e.target.closest('[data-ukey]')) {
            fermerInspecteur(true);
        }
    });

    if (urlParams.get('code')) {
        const code = urlParams.get('code');
        window.history.replaceState({}, document.title, window.location.pathname);
        await echangerCodeOAuth(code);
        return;
    }

    if (localStorage.getItem('d2_accessToken') || localStorage.getItem('d2_refreshToken') || localStorage.getItem('d2_bungieName')) {
        lancerAnalyse();
    }
};

function basculerConfig() { document.getElementById('configDrawer').classList.toggle('open'); }
function setStatus(msg) { document.getElementById('statusText').textContent = msg; }

function enregistrerConfig() {
    const b = document.getElementById('bungieName').value.trim();
    if (b) localStorage.setItem('d2_bungieName', b);
    document.getElementById('configDrawer').classList.remove('open');
    lancerAnalyse();
}

function connexionRapideBungie() {
    window.location.href = `https://www.bungie.net/fr/OAuth/Authorize?client_id=${DEFAULT_CLIENT_ID}&response_type=code`;
}

async function echangerCodeOAuth(codeRecu) {
    if (!codeRecu) return;
    try {
        setStatus("Connexion OAuth persistante via ton Worker Cloudflare...");
        const resp = await fetch(OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-API-Key': DEFAULT_API_KEY },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: codeRecu, client_id: DEFAULT_CLIENT_ID })
        });
        const data = await resp.json();
        if (data.access_token) {
            sauvegarderTokens(data);
            document.getElementById('configDrawer').classList.remove('open');
            lancerAnalyse();
        } else {
            setStatus("Erreur OAuth : " + (data.error_description || data.error || "Code expiré."));
        }
    } catch (e) { setStatus("Erreur OAuth Worker : " + e.message); }
}

function sauvegarderTokens(data) {
    localStorage.setItem('d2_accessToken', data.access_token);
    if (data.refresh_token) localStorage.setItem('d2_refreshToken', data.refresh_token);
    localStorage.setItem('d2_tokenExpiry', Date.now() + ((data.expires_in || 3600) * 1000) - 90000);
    if (data.refresh_expires_in) {
        localStorage.setItem('d2_refreshExpiry', Date.now() + (data.refresh_expires_in * 1000));
    }
}

async function obtenirTokenValide() {
    const token = localStorage.getItem('d2_accessToken');
    const expiry = parseInt(localStorage.getItem('d2_tokenExpiry') || '0', 10);
    const refresh = localStorage.getItem('d2_refreshToken');

    if (token && Date.now() < expiry) return token;

    if (refresh) {
        // Verrou anti-concurrence : évite d'envoyer 2 refresh_token identiques en parallèle
        if (promesseRefreshEnCours) return await promesseRefreshEnCours;

        promesseRefreshEnCours = (async () => {
            try {
                const resp = await fetch(OAUTH_TOKEN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-API-Key': DEFAULT_API_KEY },
                    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: DEFAULT_CLIENT_ID })
                });
                const data = await resp.json();
                if (data.access_token) {
                    sauvegarderTokens(data);
                    return data.access_token;
                }
                if (data.error === 'invalid_grant' || data.error === 'invalid_request') {
                    localStorage.removeItem('d2_refreshToken');
                    localStorage.removeItem('d2_accessToken');
                    localStorage.removeItem('d2_tokenExpiry');
                }
            } catch (e) {
                console.warn("Erreur renouvellement session :", e);
            } finally {
                promesseRefreshEnCours = null;
            }
            return null;
        })();

        const nouveauToken = await promesseRefreshEnCours;
        if (nouveauToken) return nouveauToken;
    }

    if (token && Date.now() >= expiry) {
        localStorage.removeItem('d2_accessToken');
        return null;
    }
    return token;
}

async function identifierJoueur(accessToken) {
    if (accessToken) {
        const resp = await fetch('https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/', {
            headers: { 'X-API-Key': DEFAULT_API_KEY, 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await resp.json();
        const memberships = data.Response?.destinyMemberships || [];
        if (memberships.length > 0) {
            const primaryId = data.Response.primaryMembershipId;
            return memberships.find(x => x.membershipId === primaryId)
                || memberships.find(x => x.applicableMembershipTypes && x.applicableMembershipTypes.length > 0)
                || memberships[0];
        }
    }
    const fullBungieName = document.getElementById('bungieName').value.trim();
    if (!fullBungieName.includes('#')) throw new Error("Clique sur 'Se connecter avec Bungie.net' en haut à droite.");
    const [displayName, displayNameCode] = fullBungieName.split('#');
    const searchResp = await fetch('https://www.bungie.net/Platform/Destiny2/SearchDestinyPlayerByBungieName/-1/', {
        method: 'POST',
        headers: { 'X-API-Key': DEFAULT_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, displayNameCode: parseInt(displayNameCode, 10) })
    });
    const searchData = await searchResp.json();
    return searchData.Response[0];
}

// =========================================================================
// MOTEUR DE TRANSFERT RAPIDE, FILE D'ATTENTE & ANTI-BUG BUNGIE
// =========================================================================
function majBadgeFile() {
    const badge = document.getElementById('queueBadge');
    const restant = fileActions.length + (traitementFile ? 1 : 0);
    if (restant > 0) {
        badge.textContent = `⏳ ${restant} action${restant > 1 ? 's' : ''} en cours...`;
        badge.classList.add('visible');
    } else {
        badge.classList.remove('visible');
    }
}

function enfilerAction(description, busyIds, fn) {
    const ids = (busyIds || []).filter(Boolean);
    ids.forEach(id => busyItems.add(id));
    fileActions.push({ description, ids, fn });
    majBadgeFile();
    afficherVue();
    mettreAJourComparateurUI();
    if (!traitementFile) executerFileActions();
}

async function executerFileActions() {
    traitementFile = true;
    let besoinStatsSync = false;

    while (fileActions.length > 0) {
        const job = fileActions.shift();
        majBadgeFile();
        try {
            setStatus(job.description);
            const result = await job.fn();
            if (result?.statsChanged) besoinStatsSync = true;
            if (result?.msg) setStatus(result.msg);
        } catch (err) {
            setStatus("⚠️ Refus Bungie : " + err.message);
        } finally {
            job.ids.forEach(id => busyItems.delete(id));
            recalculerDoublonsEtTags();
            afficherVue();
            mettreAJourComparateurUI();
        }
    }

    traitementFile = false;
    majBadgeFile();
    if (besoinStatsSync) await rafraichirStatsPersosRapide();
}

async function appelActionBungie(endpoint, payload) {
    const accessToken = await obtenirTokenValide();
    if (!accessToken) throw new Error("Session OAuth expirée. Reconnecte-toi avec Bungie.net.");
    const resp = await fetch(`https://www.bungie.net/Platform/Destiny2/Actions/Items/${endpoint}/`, {
        method: 'POST',
        headers: {
            'X-API-Key': DEFAULT_API_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data.ErrorCode !== 1) throw new Error(data.Message || `Erreur Bungie #${data.ErrorCode}`);
    return data;
}

function retirerDeSaListeLocale(item) {
    if (item.lieuType === 'vault') {
        listeCoffre = listeCoffre.filter(x => x.itemInstanceId !== item.itemInstanceId);
    } else if (item.lieuType === 'inventory' && mapPersos[item.charIdOwner]) {
        mapPersos[item.charIdOwner].inventory = mapPersos[item.charIdOwner].inventory.filter(x => x.itemInstanceId !== item.itemInstanceId);
    } else if (item.lieuType === 'equipped' && mapPersos[item.charIdOwner]) {
        mapPersos[item.charIdOwner].equipped = mapPersos[item.charIdOwner].equipped.filter(x => x.itemInstanceId !== item.itemInstanceId);
    } else if (item.lieuType === 'postmaster' && mapPersos[item.charIdOwner]) {
        mapPersos[item.charIdOwner].postmaster = mapPersos[item.charIdOwner].postmaster.filter(x => x.itemInstanceId !== item.itemInstanceId);
    }
}

function placerLocalement(item, lieuType, charId) {
    retirerDeSaListeLocale(item);
    item.lieuType = lieuType;
    item.charIdOwner = lieuType === 'vault' ? null : charId;

    if (lieuType === 'vault') {
        listeCoffre.push(item);
        listeCoffre.sort((a, b) => (b.power || 0) - (a.power || 0));
    } else if (lieuType === 'inventory' && mapPersos[charId]) {
        mapPersos[charId].inventory.push(item);
    } else if (lieuType === 'equipped' && mapPersos[charId]) {
        mapPersos[charId].equipped.push(item);
    }
}

async function apiTransfererAuCoffre(item) {
    if (item.lieuType === 'vault') return;
    if (item.lieuType === 'equipped') await apiDesequiperObjet(item);
    const charId = item.charIdOwner;
    await appelActionBungie('TransferItem', {
        itemReferenceHash: item.itemHash, stackSize: item.stackSize || 1,
        transferToVault: true, itemId: item.itemInstanceId,
        characterId: charId, membershipType: joueurInfo.membershipType
    });
    placerLocalement(item, 'vault', null);
}

async function apiLibererPlaceSacSiPlein(charId, bucketHash, excludeInstanceId = null) {
    const p = mapPersos[charId];
    if (!p) return;
    const dansBucket = p.inventory.filter(x => x.bucketHash === bucketHash);
    if (dansBucket.length < 9) return;

    const candidat = dansBucket
        .filter(x => x.itemInstanceId !== excludeInstanceId)
        .sort((a, b) => {
            const ta = obtenirTag(a) === 'godroll' || obtenirTag(a) === 'keep' ? 1 : 0;
            const tb = obtenirTag(b) === 'godroll' || obtenirTag(b) === 'keep' ? 1 : 0;
            return ta !== tb ? ta - tb : (a.power || 0) - (b.power || 0);
        })[0];

    if (!candidat) throw new Error("Sac plein (9/9) sur cet emplacement.");
    setStatus(`Sac plein (9/9) — Rangement auto de "${candidat.nom}" au Coffre...`);
    await apiTransfererAuCoffre(candidat);
}

async function apiTransfererVersSac(item, targetCharId) {
    const targetPerso = mapPersos[targetCharId];
    if (!targetPerso) throw new Error("Personnage cible introuvable.");
    if (item.categorie === 'armor' && item.classType !== 3 && item.classType !== targetPerso.classType) {
        throw new Error(`Impossible : "${item.nom}" est réservé à la classe ${classesNom[item.classType] || 'autre'}.`);
    }
    if (item.lieuType === 'inventory' && item.charIdOwner === targetCharId) return;

    if (item.lieuType === 'equipped') {
        const memePerso = item.charIdOwner === targetCharId;
        await apiDesequiperObjet(item);
        if (memePerso) return;
    }
    if (item.lieuType === 'inventory' && item.charIdOwner !== targetCharId) {
        await apiTransfererAuCoffre(item);
    }

    await apiLibererPlaceSacSiPlein(targetCharId, item.bucketHash, item.itemInstanceId);
    await appelActionBungie('TransferItem', {
        itemReferenceHash: item.itemHash, stackSize: item.stackSize || 1,
        transferToVault: false, itemId: item.itemInstanceId,
        characterId: targetCharId, membershipType: joueurInfo.membershipType
    });
    placerLocalement(item, 'inventory', targetCharId);
}

async function apiDesequiperObjet(item) {
    if (item.lieuType !== 'equipped') return;
    const charId = item.charIdOwner;
    const p = mapPersos[charId];
    if (!p) return;

    let rempla = p.inventory.find(x => x.bucketHash === item.bucketHash && x.tier !== 'Exotic');
    if (!rempla) {
        rempla = listeCoffre.find(x =>
            x.bucketHash === item.bucketHash && x.tier !== 'Exotic' &&
            (x.categorie !== 'armor' || x.classType === 3 || x.classType === p.classType)
        );
        if (rempla) {
            setStatus(`Récupération de "${rempla.nom}" pour remplacer "${item.nom}"...`);
            await apiTransfererVersSac(rempla, charId);
        }
    }
    if (!rempla) throw new Error(`Aucun objet Légendaire disponible pour remplacer "${item.nom}".`);
    await apiEquiperDirect(rempla, charId);
}

async function apiResoudreConflitExotique(item, targetCharId) {
    if (item.tier !== 'Exotic') return;
    const p = mapPersos[targetCharId];
    if (!p) return;
    const autreExo = p.equipped.find(x => x.tier === 'Exotic' && x.categorie === item.categorie && x.bucketHash !== item.bucketHash);
    if (autreExo) {
        setStatus(`Conflit Exotique — Déséquipement auto de "${autreExo.nom}"...`);
        await apiDesequiperObjet(autreExo);
    }
}

async function apiEquiperDirect(item, targetCharId) {
    const p = mapPersos[targetCharId];
    if (!p) return;
    if (item.categorie === 'armor' && item.classType !== 3 && item.classType !== p.classType) {
        throw new Error(`Impossible : "${item.nom}" est réservé à la classe ${classesNom[item.classType] || 'autre'}.`);
    }
    if (item.lieuType === 'equipped' && item.charIdOwner === targetCharId) return;

    await apiResoudreConflitExotique(item, targetCharId);
    if (item.lieuType !== 'inventory' || item.charIdOwner !== targetCharId) {
        await apiTransfererVersSac(item, targetCharId);
    }

    const ancienEquipe = p.equipped.find(x => x.bucketHash === item.bucketHash);
    await appelActionBungie('EquipItem', {
        itemId: item.itemInstanceId, characterId: targetCharId, membershipType: joueurInfo.membershipType
    });
    if (ancienEquipe) placerLocalement(ancienEquipe, 'inventory', targetCharId);
    placerLocalement(item, 'equipped', targetCharId);
}

async function rafraichirStatsPersosRapide() {
    if (!joueurInfo) return;
    try {
        const accessToken = await obtenirTokenValide();
        const url = `https://www.bungie.net/Platform/Destiny2/${joueurInfo.membershipType}/Profile/${joueurInfo.membershipId}/?components=200`;
        const headers = { 'X-API-Key': DEFAULT_API_KEY };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
        const resp = await fetch(url, { headers });
        const data = await resp.json();
        const chars = data.Response?.characters?.data || {};
        for (const [cId, c] of Object.entries(chars)) {
            if (mapPersos[cId]) {
                mapPersos[cId].light = c.light;
                mapPersos[cId].statsGlobales = c.stats || {};
                if (c.emblemPath) mapPersos[cId].emblem = 'https://www.bungie.net' + c.emblemPath;
                if (c.emblemBackgroundPath) mapPersos[cId].emblemBg = 'https://www.bungie.net' + c.emblemBackgroundPath;
            }
        }
        afficherBarrePersos();
        afficherStatsGlobalesGardien();
    } catch (e) { console.warn("Sync stats rapide :", e); }
}

async function synchroniserInventaireRapide() {
    if (!joueurInfo || !dictGlobal.items) return lancerAnalyse();
    try {
        const t0 = performance.now();
        setStatus("⚡ Synchronisation rapide du Coffre et des Personnages...");
        const accessToken = await obtenirTokenValide();
        const url = `https://www.bungie.net/Platform/Destiny2/${joueurInfo.membershipType}/Profile/${joueurInfo.membershipId}/?components=102,200,201,205,300,302,304`;
        const headers = { 'X-API-Key': DEFAULT_API_KEY };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

        const resp = await fetch(url, { headers });
        const data = await resp.json();
        const r = data.Response;
        if (!r) throw new Error("Réponse Bungie invalide.");

        appliquerDonneesInventaire(r);
        const ms = Math.round(performance.now() - t0);
        setStatus(`⚡ Inventaire synchronisé en ${ms} ms — ${listeCoffre.length} objets au Coffre.`);
        if (ongletActif === 'optimizer') calculerOptimisationArmures(false);
        afficherVue();
        mettreAJourComparateurUI();
    } catch (e) { setStatus("Erreur synchro rapide : " + e.message); }
}

function recalculerDoublonsEtTags() {
    compteDoublons = {};
    const compter = (item) => { if (item?.itemHash) compteDoublons[item.itemHash] = (compteDoublons[item.itemHash] || 0) + 1; };
    Object.values(mapPersos).forEach(p => { p.equipped.forEach(compter); p.inventory.forEach(compter); });
    listeCoffre.forEach(compter);

    let nbDoublons = 0;
    Object.values(compteDoublons).forEach(cnt => { if (cnt > 1) nbDoublons += cnt; });
    const elDupes = document.getElementById('count-dupes');
    if (elDupes) elDupes.textContent = nbDoublons;
    mettreAJourOptionsTags();
}

function executerMouvement(cibleMode, itemHash, itemInstanceId, lieuActuel, sourceCharId = '') {
    fermerInspecteur(true);
    const item = registreObjets[itemInstanceId];
    if (!item) return;

    const nomPerso = mapPersos[persoActifId]?.classeNom || 'Perso';
    const labelAction = cibleMode === 'vault'
        ? `Rangement de "${item.nom}" au Coffre...`
        : (cibleMode === 'equipped'
            ? `Équipement de "${item.nom}" sur ${nomPerso}...`
            : `Transfert de "${item.nom}" vers le Sac (${nomPerso})...`);

    enfilerAction(labelAction, [item.itemInstanceId], async () => {
        if (cibleMode === 'vault') {
            await apiTransfererAuCoffre(item);
            return { statsChanged: lieuActuel === 'equipped', msg: `✓ "${item.nom}" rangé dans le Coffre.` };
        }
        if (cibleMode === 'inventory') {
            await apiTransfererVersSac(item, persoActifId);
            return { statsChanged: lieuActuel === 'equipped', msg: `✓ "${item.nom}" transféré dans le Sac (${nomPerso}).` };
        }
        if (cibleMode === 'equipped') {
            await apiEquiperDirect(item, persoActifId);
            return { statsChanged: true, msg: `✓ "${item.nom}" équipé sur ${nomPerso}.` };
        }
    });
}

function transfererVersAutrePerso(itemHash, itemInstanceId, lieuActuel, sourceCharId, targetCharId) {
    fermerInspecteur(true);
    const item = registreObjets[itemInstanceId];
    if (!item || !targetCharId) return;
    if (item.lieuType === 'inventory' && item.charIdOwner === targetCharId) return;

    const nomCible = mapPersos[targetCharId]?.classeNom || 'Personnage';
    enfilerAction(`Transfert de "${item.nom}" vers ${nomCible}...`, [item.itemInstanceId], async () => {
        const wasEq = item.lieuType === 'equipped';
        await apiTransfererVersSac(item, targetCharId);
        return { statsChanged: wasEq, msg: `✓ "${item.nom}" livré dans le Sac de ton ${nomCible}.` };
    });
}

function recupererDuPostmaster(itemHash, itemInstanceId, stackSize) {
    fermerInspecteur(true);
    const item = registreObjets[itemInstanceId];
    const nom = item ? item.nom : 'Objet';

    enfilerAction(`Récupération de "${nom}" chez le Commis des postes...`, [itemInstanceId], async () => {
        if (item) await apiLibererPlaceSacSiPlein(persoActifId, item.bucketHash);
        await appelActionBungie('PullFromPostmaster', {
            itemReferenceHash: itemHash, stackSize: stackSize || 1,
            itemId: itemInstanceId || "0", characterId: persoActifId, membershipType: joueurInfo.membershipType
        });
        if (item && BUCKETS_CONNUS.has(item.bucketHash)) placerLocalement(item, 'inventory', persoActifId);
        else if (item) retirerDeSaListeLocale(item);
        return { statsChanged: false, msg: `✓ "${nom}" récupéré dans le Sac !` };
    });
}

function toutRecupererDuPostmaster() {
    const p = mapPersos[persoActifId];
    if (!p || p.postmaster.length === 0) return;
    const items = [...p.postmaster];

    enfilerAction(`Vidage du Commis des postes (${items.length} objets)...`, items.map(i => i.itemInstanceId), async () => {
        let ok = 0;
        for (const item of items) {
            try {
                if (BUCKETS_CONNUS.has(item.bucketHash)) await apiLibererPlaceSacSiPlein(persoActifId, item.bucketHash);
                await appelActionBungie('PullFromPostmaster', {
                    itemReferenceHash: item.itemHash, stackSize: item.stackSize || 1,
                    itemId: item.itemInstanceId || "0", characterId: persoActifId, membershipType: joueurInfo.membershipType
                });
                if (BUCKETS_CONNUS.has(item.bucketHash)) placerLocalement(item, 'inventory', persoActifId);
                else retirerDeSaListeLocale(item);
                ok++;
            } catch (e) { console.warn("Postmaster skip:", item.nom, e.message); }
        }
        return { statsChanged: false, msg: `✓ ${ok}/${items.length} objets récupérés du Commis des postes.` };
    });
}

// =========================================================================
// TAGS & FAVORIS
// =========================================================================
function chargerTagsLocale() {
    try { itemTags = JSON.parse(localStorage.getItem('d2_itemTags') || '{}'); }
    catch { itemTags = {}; }
}
function sauvegarderTagsLocale() { localStorage.setItem('d2_itemTags', JSON.stringify(itemTags)); }
function obtenirTag(item) { return (item && item.itemInstanceId) ? (itemTags[item.itemInstanceId] || null) : null; }

function definirTag(itemInstanceId, tagId) {
    if (!itemInstanceId) return;
    if (itemTags[itemInstanceId] === tagId) delete itemTags[itemInstanceId];
    else itemTags[itemInstanceId] = tagId;
    sauvegarderTagsLocale();
    mettreAJourOptionsTags();
    afficherVue();
    mettreAJourComparateurUI();
    if (inspecteurVerrouille && inspecteurUkeyActif && registreObjets[inspecteurUkeyActif]) {
        rendreContenuInspecteur(registreObjets[inspecteurUkeyActif]);
    }
}

function mettreAJourOptionsTags() {
    const comptes = { godroll: 0, keep: 0, infuse: 0, junk: 0 };
    Object.values(registreObjets).forEach(obj => {
        if (obj.itemInstanceId && itemTags[obj.itemInstanceId]) {
            const t = itemTags[obj.itemInstanceId];
            if (comptes[t] !== undefined) comptes[t]++;
        }
    });
    const sel = document.getElementById('filtreTag');
    if (!sel) return;
    const valActuelle = sel.value;
    sel.innerHTML = `
        <option value="all">Tag : Tous</option>
        <option value="godroll">⭐ God Roll (${comptes.godroll})</option>
        <option value="keep">🔒 À garder (${comptes.keep})</option>
        <option value="infuse">⚡ À infuser (${comptes.infuse})</option>
        <option value="junk">🗑️ À démanteler (${comptes.junk})</option>
        <option value="untagged">Sans tag</option>
    `;
    sel.value = valActuelle;

    const junkDansCoffre = listeCoffre.filter(i => obtenirTag(i) === 'junk').length;
    const btnPull = document.getElementById('btnPullJunk');
    btnPull.style.display = (ongletActif === 'loadout' && junkDansCoffre > 0 && (valActuelle === 'junk' || valActuelle === 'all')) ? 'inline-block' : 'none';
    btnPull.textContent = `🎒 Rapatrier ${junkDansCoffre} 🗑️ du Coffre`;
}

function rapatrierObjetsADemanteler() {
    const junkVault = listeCoffre.filter(i => obtenirTag(i) === 'junk');
    if (junkVault.length === 0 || !persoActifId) return;
    const nomPerso = mapPersos[persoActifId]?.classeNom || 'Perso';

    enfilerAction(`Rapatriement de ${junkVault.length} objets 🗑️ vers ${nomPerso}...`, junkVault.map(i => i.itemInstanceId), async () => {
        let ok = 0;
        for (const item of junkVault) {
            try { await apiTransfererVersSac(item, persoActifId); ok++; }
            catch (e) { console.warn("Skip junk:", item.nom, e.message); }
        }
        return { statsChanged: false, msg: `✓ ${ok}/${junkVault.length} objets 🗑️ rapatriés dans le Sac (${nomPerso}).` };
    });
}

function basculerFiltreDoublons() {
    filtreDoublonsActif = !filtreDoublonsActif;
    document.getElementById('btnFiltreDoublons').classList.toggle('active', filtreDoublonsActif);
    afficherVue();
}

// =========================================================================
// ÉLÉMENTS & PARSING DES DONNÉES BUNGIE
// =========================================================================
function extraireElement(def, inst) {
    if (!def || def.itemType !== 3) return null;
    const dType = inst?.damageType || def.defaultDamageType;
    const meta = ELEMENTS_META[dType];
    if (!meta) return null;
    const dHash = inst?.damageTypeHash || def.defaultDamageTypeHash;
    const dDef = dHash ? dictGlobal.damageTypes?.[dHash] : null;
    const iconPath = dDef?.displayProperties?.icon || dDef?.transparentIconPath || '';
    return {
        type: dType,
        nom: dDef?.displayProperties?.name || meta.nom,
        court: meta.court,
        color: meta.color,
        icone: iconPath ? 'https://www.bungie.net' + iconPath : ''
    };
}

function rendreElementInline(item, afficherNom = true) {
    if (!item?.element) return '';
    const e = item.element;
    const imgHtml = e.icone
        ? `<img class="elem-icon-sm" src="${e.icone}" alt="${e.court}" title="${e.nom}">`
        : `<span class="elem-dot" style="background:${e.color};"></span>`;
    return `<span class="elem-inline" style="color:${e.color};">${imgHtml}${afficherNom ? `<span>${e.court}</span>` : ''}</span>`;
}

function calculerCompteAReboursReset() {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0, 0));
    const day = now.getUTCDay();
    let joursRestants = (2 - day + 7) % 7;
    if (joursRestants === 0 && now.getTime() >= target.getTime()) joursRestants = 7;
    target.setUTCDate(target.getUTCDate() + joursRestants);
    const diffMs = Math.max(0, target.getTime() - now.getTime());
    const d = Math.floor(diffMs / 86400000);
    const h = Math.floor((diffMs % 86400000) / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    return `${d}j ${h}h ${m}m`;
}

function extrairePerksDetails(instanceId, itemPerks) {
    const liste = [];
    if (instanceId && itemPerks[instanceId]?.perks && dictGlobal.perks) {
        const dejaVu = new Set();
        itemPerks[instanceId].perks.forEach(p => {
            const pDef = dictGlobal.perks[p.perkHash];
            if (p.visible && pDef?.displayProperties?.name && !dejaVu.has(pDef.displayProperties.name) && liste.length < 6) {
                dejaVu.add(pDef.displayProperties.name);
                liste.push({
                    nom: pDef.displayProperties.name,
                    desc: pDef.displayProperties.description || "",
                    icone: pDef.displayProperties.icon ? 'https://www.bungie.net' + pDef.displayProperties.icon : ''
                });
            }
        });
    }
    return liste;
}

function extraireStatsObjet(def, instanceId, itemStatsMap) {
    const estArme = def.itemType === 3;
    const ordreCible = estArme ? STATS_ARMES_ORDRE : STATS_ARMURES_ORDRE;
    const liveStats = (instanceId && itemStatsMap && itemStatsMap[instanceId]?.stats) ? itemStatsMap[instanceId].stats : {};
    const baseStats = def.stats?.stats || {};

    const resultat = [];
    let totalArmure = 0;

    ordreCible.forEach(statHash => {
        const val = liveStats[statHash]?.value ?? baseStats[statHash]?.value;
        const sDef = dictGlobal.stats?.[statHash];
        if (val !== undefined && val > 0 && sDef?.displayProperties?.name) {
            const nomCourt = sDef.displayProperties.name
                .replace('Vitesse de rechargement', 'Rechargement')
                .replace('Coups par minute', 'Cadence (CPM)');
            resultat.push({
                hash: statHash, nom: nomCourt, val: val,
                isBar: ![4284893193, 3871231066, 2961396640, 447667954].includes(statHash)
            });
            if (!estArme) totalArmure += val;
        }
    });

    if (!estArme && totalArmure > 0) {
        resultat.push({ hash: 0, nom: "Total des stats", val: totalArmure, isBar: false, isTotal: true });
    }
    return resultat;
}

function extraireVecteur6Armure(def, instanceId, itemStatsMap) {
    if (def.itemType !== 2) return null;
    const liveStats = (instanceId && itemStatsMap && itemStatsMap[instanceId]?.stats) ? itemStatsMap[instanceId].stats : {};
    const baseStats = def.stats?.stats || {};
    return STATS_ARMURES_ORDRE.map(h => liveStats[h]?.value ?? baseStats[h]?.value ?? 0);
}

function formaterEquipement(item, lieuType, charIdOwner, instances, itemPerks, itemStatsMap, forcePostmaster = false) {
    const def = dictGlobal.items[item.itemHash];
    if (!def || !def.displayProperties?.name) return null;
    const bucketHash = def.inventory?.bucketTypeHash;
    if (!forcePostmaster && !BUCKETS_CONNUS.has(bucketHash)) return null;

    const instanceId = item.itemInstanceId;
    const inst = instanceId ? instances[instanceId] : null;
    const power = inst?.primaryStat?.value ? inst.primaryStat.value : null;
    const isMasterwork = ((item.state || 0) & 4) !== 0;
    const tierKey = def.inventory?.tierType === 6 ? 'Exotic' : (def.inventory?.tierType === 5 ? 'Superior' : 'Rare');
    const perks = extrairePerksDetails(instanceId, itemPerks);
    const stats = extraireStatsObjet(def, instanceId, itemStatsMap);
    const armorStats6 = extraireVecteur6Armure(def, instanceId, itemStatsMap);
    const element = extraireElement(def, inst);
    const ukey = instanceId || ('hash_' + item.itemHash + '_' + Math.random().toString(36).substring(2, 7));

    const obj = {
        ukey,
        nom: def.displayProperties.name,
        typeNom: def.itemTypeDisplayName || 'Équipement',
        flavor: def.flavorText || "",
        itemHash: item.itemHash,
        itemInstanceId: instanceId,
        stackSize: item.quantity || 1,
        bucketHash: bucketHash,
        classType: def.classType,
        isMasterwork: isMasterwork,
        lieuType: lieuType,
        charIdOwner: charIdOwner,
        icone: def.displayProperties.icon ? 'https://www.bungie.net' + def.displayProperties.icon : '',
        power: power,
        element: element,
        perks: perks,
        stats: stats,
        armorStats6: armorStats6,
        categorie: def.itemType === 3 ? 'weapon' : 'armor',
        tier: tierKey
    };
    registreObjets[ukey] = obj;
    return obj;
}

function appliquerDonneesInventaire(resp, charProgressions = null) {
    const instances = resp.itemComponents?.instances?.data || {};
    const itemPerks = resp.itemComponents?.perks?.data || {};
    const itemStatsMap = resp.itemComponents?.stats?.data || {};

    const nouveauRegistre = {};
    for (const [k, v] of Object.entries(registreObjets)) {
        if (!v.itemInstanceId) nouveauRegistre[k] = v;
    }
    registreObjets = nouveauRegistre;

    const anciensJalons = {};
    Object.entries(mapPersos).forEach(([id, p]) => { anciensJalons[id] = p.milestones || []; });

    mapPersos = {};
    for (const [cId, c] of Object.entries(resp.characters?.data || {})) {
        const jalonsPerso = charProgressions ? extraireJalonsPerso(charProgressions[cId]?.milestones) : (anciensJalons[cId] || []);
        mapPersos[cId] = {
            id: cId,
            classType: c.classType,
            classeNom: classesNom[c.classType] || 'Gardien',
            light: c.light,
            statsGlobales: c.stats || {},
            emblem: c.emblemPath ? 'https://www.bungie.net' + c.emblemPath : '',
            emblemBg: c.emblemBackgroundPath ? 'https://www.bungie.net' + c.emblemBackgroundPath : '',
            equipped: [],
            inventory: [],
            postmaster: [],
            milestones: jalonsPerso
        };
    }
    if (!persoActifId || !mapPersos[persoActifId]) {
        persoActifId = Object.keys(mapPersos)[0];
    }
    afficherBarrePersos();

    for (const [cId, data] of Object.entries(resp.characterEquipment?.data || {})) {
        data.items.forEach(i => {
            const fmt = formaterEquipement(i, 'equipped', cId, instances, itemPerks, itemStatsMap);
            if (fmt) mapPersos[cId].equipped.push(fmt);
        });
    }

    listeQuetes = [];
    for (const [cId, data] of Object.entries(resp.characterInventories?.data || {})) {
        data.items.forEach(i => {
            const def = dictGlobal.items[i.itemHash];
            if (!def) return;
            if (i.bucketHash === BUCKET_POSTMASTER) {
                const fmtPost = formaterEquipement(i, 'postmaster', cId, instances, itemPerks, itemStatsMap, true);
                if (fmtPost) mapPersos[cId].postmaster.push(fmtPost);
            } else if (def.itemType === 12 || (def.itemCategoryHashes && def.itemCategoryHashes.includes(53))) {
                listeQuetes.push({
                    nom: def.displayProperties.name,
                    source: def.displayProperties.description || "Quête / Contrat",
                    icone: def.displayProperties.icon ? 'https://www.bungie.net' + def.displayProperties.icon : '',
                    possede: false,
                    categorie: 'quest',
                    tier: 'Superior',
                    badgeTexte: mapPersos[cId]?.classeNom || 'Quête'
                });
            } else {
                const fmt = formaterEquipement(i, 'inventory', cId, instances, itemPerks, itemStatsMap);
                if (fmt) mapPersos[cId].inventory.push(fmt);
            }
        });
    }

    listeCoffre = [];
    (resp.profileInventory?.data?.items || []).forEach(i => {
        const fmt = formaterEquipement(i, 'vault', null, instances, itemPerks, itemStatsMap);
        if (fmt) listeCoffre.push(fmt);
    });
    listeCoffre.sort((a, b) => (b.power || 0) - (a.power || 0));

    document.getElementById('count-quests').textContent = listeQuetes.length;
    comparateurKeys = comparateurKeys.filter(k => registreObjets[k]);
    recalculerDoublonsEtTags();
    mettreAJourCompteurJalons();
}

function collecterRecordsDansNoeud(nodeHash, visited = new Set()) {
    const res = [];
    if (!nodeHash || visited.has(nodeHash)) return res;
    visited.add(nodeHash);
    const node = dictGlobal.nodes?.[nodeHash];
    if (!node) return res;
    (node.children?.records || []).forEach(r => res.push(r.recordHash));
    (node.children?.presentationNodes || []).forEach(child => {
        res.push(...collecterRecordsDansNoeud(child.presentationNodeHash, visited));
    });
    return res;
}

function extraireJalonsPerso(milestonesData) {
    const jalons = [];
    if (!milestonesData || !dictGlobal.milestones) return jalons;

    const motsRaidDonjon = [
        'raid', 'donjon', 'caveau', 'chute du roi', 'serment', 'racine', 'cropta',
        'bord du salut', 'dualisme', 'flèche', 'fantômes', 'ruine', 'hôte', 'vesper',
        'doctrine', 'prophétie', 'fosse', 'trône brisé', 'emprise', 'dernier vœu', 'jardin', 'crypte'
    ];
    const motsRituels = ['nuit noire', 'avant-garde', 'épreuve', 'gambit', 'jugement', 'bannière', 'assaut', 'osiris', 'compétitif'];

    for (const [mHash, mLive] of Object.entries(milestonesData)) {
        const mDef = dictGlobal.milestones[mHash];
        if (!mDef || !mDef.displayProperties?.name) continue;

        const nomJalon = mDef.displayProperties.name;
        let descJalon = mDef.displayProperties.description || "";
        let icone = mDef.displayProperties.icon ? 'https://www.bungie.net' + mDef.displayProperties.icon : '';

        let recompenseLabel = "";
        if (mDef.rewards) {
            for (const rCat of Object.values(mDef.rewards)) {
                for (const entry of Object.values(rCat.rewardEntries || {})) {
                    const rName = entry.displayProperties?.name || "";
                    if (rName) { recompenseLabel = rName; break; }
                }
                if (recompenseLabel) break;
            }
        }

        const objectifs = [];
        const objVus = new Set();
        let phases = [];
        let nomActiviteAssociee = "";

        if (mLive.availableQuests) {
            mLive.availableQuests.forEach(q => {
                (q.status?.stepObjectives || []).forEach(o => {
                    if (objVus.has(o.objectiveHash)) return;
                    objVus.add(o.objectiveHash);
                    const oDef = dictGlobal.objectives?.[o.objectiveHash];
                    objectifs.push({
                        texte: oDef?.progressDescription || "Objectif hebdomadaire",
                        progress: o.progress || 0, max: o.completionValue || 1, complete: !!o.complete
                    });
                });
            });
        }

        if (mLive.activities) {
            mLive.activities.forEach(act => {
                const actDef = dictGlobal.activities?.[act.activityHash];
                if (actDef?.displayProperties?.name && !nomActiviteAssociee) nomActiviteAssociee = actDef.displayProperties.name;
                if (!icone && actDef?.displayProperties?.icon) icone = 'https://www.bungie.net' + actDef.displayProperties.icon;
                if (act.phases && act.phases.length > phases.length) phases = act.phases.map(ph => ({ complete: !!ph.complete }));
                (act.challenges || []).forEach(ch => {
                    const o = ch.objective;
                    if (!o || objVus.has(o.objectiveHash)) return;
                    objVus.add(o.objectiveHash);
                    const oDef = dictGlobal.objectives?.[o.objectiveHash];
                    objectifs.push({
                        texte: oDef?.progressDescription || "Défi hebdomadaire",
                        progress: o.progress || 0, max: o.completionValue || 1, complete: !!o.complete
                    });
                });
            });
        }

        let rewardEntriesLive = [];
        if (mLive.rewards) mLive.rewards.forEach(r => (r.entries || []).forEach(e => rewardEntriesLive.push(e)));
        if (objectifs.length === 0 && phases.length === 0 && rewardEntriesLive.length === 0) continue;

        let complete = false;
        if (objectifs.length > 0) complete = objectifs.every(o => o.complete);
        else if (phases.length > 0) complete = phases.every(p => p.complete);
        else if (rewardEntriesLive.length > 0) complete = rewardEntriesLive.every(e => e.earned || e.redeemed);

        const texteRecherche = `${nomJalon} ${descJalon} ${nomActiviteAssociee}`.toLowerCase();
        let groupe = 'weekly';
        if (phases.length > 0 || motsRaidDonjon.some(m => texteRecherche.includes(m))) groupe = 'raid_dungeon';
        else if (motsRituels.some(m => texteRecherche.includes(m))) groupe = 'ritual';

        const estPrestige = `${recompenseLabel} ${descJalon}`.toLowerCase().includes('prestige') || `${recompenseLabel} ${descJalon}`.toLowerCase().includes('pinnacle');
        const estPuissant = `${recompenseLabel} ${descJalon}`.toLowerCase().includes('puissant') || `${recompenseLabel} ${descJalon}`.toLowerCase().includes('powerful');

        jalons.push({
            nom: nomJalon,
            sousTitre: nomActiviteAssociee && nomActiviteAssociee !== nomJalon ? nomActiviteAssociee : descJalon,
            desc: descJalon,
            icone: icone || 'https://www.bungie.net/img/misc/missing_icon_d2.png',
            recompense: recompenseLabel || (estPrestige ? 'Équipement de prestige' : (estPuissant ? 'Équipement puissant' : 'Récompense hebdomadaire')),
            estPrestige, estPuissant, groupe, objectifs, phases, possede: complete
        });
    }

    jalons.sort((a, b) => {
        if (a.possede !== b.possede) return a.possede ? 1 : -1;
        if (a.estPrestige !== b.estPrestige) return a.estPrestige ? -1 : 1;
        return a.nom.localeCompare(b.nom);
    });
    return jalons;
}

async function lancerAnalyse() {
    try {
        const t0 = performance.now();
        const accessToken = await obtenirTokenValide();
        setStatus("1/3 — Identification du Gardien...");
        joueurInfo = await identifierJoueur(accessToken);

        const nomAffiche = joueurInfo.bungieGlobalDisplayName
            ? `${joueurInfo.bungieGlobalDisplayName}#${joueurInfo.bungieGlobalDisplayNameCode}`
            : (joueurInfo.displayName || "Gardien Connecté");
        const badge = document.getElementById('userBadge');
        badge.textContent = "✦ " + nomAffiche;
        badge.style.display = "inline-block";
        if (accessToken) {
            const hasRefresh = Boolean(localStorage.getItem('d2_refreshToken'));
            document.getElementById('btnMainLogin').textContent = hasRefresh ? "✓ Session 90j Active" : "✓ Compte Bungie Lié";
        }

        await chargerManifestAvecCache();

        setStatus("3/3 — Lecture complète du compte Destiny 2...");
        const profileUrl = `https://www.bungie.net/Platform/Destiny2/${joueurInfo.membershipType}/Profile/${joueurInfo.membershipId}/?components=102,200,201,202,205,300,302,304,800,900`;
        const headers = { 'X-API-Key': DEFAULT_API_KEY };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

        const profileResp = await fetch(profileUrl, { headers });
        const profileData = await profileResp.json();
        const resp = profileData.Response;

        appliquerDonneesInventaire(resp, resp.characterProgressions?.data || {});

        const mapArmesParNom = {};
        for (const itemDef of Object.values(dictGlobal.items)) {
            if (itemDef.itemType === 3 && itemDef.displayProperties?.name && itemDef.inventory?.tierType >= 5) {
                mapArmesParNom[itemDef.displayProperties.name] = itemDef;
            }
        }

        const collectiblesJoueur = { ...(resp.profileCollectibles?.data?.collectibles || {}) };
        for (const cId in (resp.characterCollectibles?.data || {})) {
            Object.assign(collectiblesJoueur, resp.characterCollectibles.data[cId].collectibles);
        }
        listeExotiques = [];
        for (const [hash, def] of Object.entries(dictGlobal.collectibles)) {
            if (!def.displayProperties?.name || !def.displayProperties?.icon) continue;
            const itemDef = dictGlobal.items[def.itemHash];
            const isExo = itemDef?.inventory?.tierType === 6;
            const cat = itemDef?.itemType === 3 ? 'weapon' : (itemDef?.itemType === 2 ? 'armor' : 'other');
            const possede = ((collectiblesJoueur[hash]?.state ?? 1) & 1) === 0;
            const ukey = 'col_' + hash;
            const obj = {
                ukey,
                nom: def.displayProperties.name,
                typeNom: itemDef?.itemTypeDisplayName || "Collection",
                flavor: itemDef?.flavorText || "",
                source: def.sourceString || "Collection Destiny 2",
                icone: 'https://www.bungie.net' + def.displayProperties.icon,
                element: itemDef ? extraireElement(itemDef, null) : null,
                possede, categorie: cat, tier: isExo ? 'Exotic' : 'Superior',
                badgeTexte: possede ? 'Débloqué' : 'Manquant',
                stats: itemDef ? extraireStatsObjet(itemDef, null, null) : [],
                perks: []
            };
            registreObjets[ukey] = obj;
            listeExotiques.push(obj);
        }

        const recordsJoueur = { ...(resp.profileRecords?.data?.records || {}) };
        for (const cId in (resp.characterRecords?.data || {})) {
            Object.assign(recordsJoueur, resp.characterRecords.data[cId].records);
        }

        const hashesCatalyseurs = new Set();
        for (const n of Object.values(dictGlobal.nodes || {})) {
            const nNom = (n.displayProperties?.name || "").toLowerCase();
            if (nNom === "catalyseurs exotiques" || nNom.includes("catalyseurs exotiques") || n.hash === 1984921914) {
                collecterRecordsDansNoeud(n.hash).forEach(rh => hashesCatalyseurs.add(String(rh)));
            }
        }

        listeTriomphes = [];
        listeCrafting = [];
        listeCatalyseurs = [];
        const nomsCraftingVus = new Set();
        const nomsCatVus = new Set();

        for (const [hash, rec] of Object.entries(recordsJoueur)) {
            const def = dictGlobal.records[hash];
            if (!def || !def.displayProperties?.name) continue;
            const nomRec = def.displayProperties.name;
            const descRec = def.displayProperties.description || "";
            const complete = (rec.state & 4) === 0;

            const estCatalyseur = hashesCatalyseurs.has(String(hash)) || nomRec.toLowerCase().startsWith('catalyseur');
            if (estCatalyseur && !nomsCatVus.has(nomRec)) {
                nomsCatVus.add(nomRec);
                const objs = rec.objectives || [];
                let mainObj = objs[0] || { progress: 0, completionValue: 1 };
                objs.forEach(o => { if ((o.completionValue || 0) >= (mainObj.completionValue || 0)) mainObj = o; });
                const prog = mainObj.progress || 0;
                const max = mainObj.completionValue || 1;
                const enCours = !complete && (prog > 0 || objs.some(o => o.complete));

                const ukey = 'cat_' + hash;
                const objCat = {
                    ukey, nom: nomRec, typeNom: "Catalyseur Exotique", flavor: descRec,
                    source: descRec || "Catalyseur d'arme exotique",
                    icone: def.displayProperties.icon ? 'https://www.bungie.net' + def.displayProperties.icon : 'https://www.bungie.net/img/misc/missing_icon_d2.png',
                    possede: complete, enCours, progActuel: prog, progMax: max,
                    categorie: 'weapon', tier: 'Exotic',
                    badgeTexte: complete ? '✓ Complété' : (enCours ? `⚡ En cours (${prog} / ${max})` : '🔒 Manquant / Non commencé'),
                    stats: [], perks: []
                };
                registreObjets[ukey] = objCat;
                listeCatalyseurs.push(objCat);
                continue;
            }

            const armeMatch = mapArmesParNom[nomRec];
            const objZero = rec.objectives && rec.objectives.length > 0 ? rec.objectives[0] : null;
            const estModeleArme = armeMatch && objZero && objZero.completionValue >= 1 && objZero.completionValue <= 5 && !nomsCraftingVus.has(nomRec);

            if (estModeleArme) {
                nomsCraftingVus.add(nomRec);
                const prog = objZero.progress || 0;
                const max = objZero.completionValue || 5;
                const ukey = 'craft_' + hash;
                const objCraft = {
                    ukey, nom: nomRec,
                    typeNom: armeMatch.itemTypeDisplayName || "Arme façonnable",
                    flavor: armeMatch.flavorText || "",
                    source: `${armeMatch.itemTypeDisplayName || 'Arme'} — ${prog} / ${max} bordures rouges`,
                    icone: 'https://www.bungie.net' + armeMatch.displayProperties.icon,
                    element: extraireElement(armeMatch, null),
                    possede: complete, progActuel: prog, progMax: max,
                    categorie: 'weapon', tier: armeMatch.inventory?.tierType === 6 ? 'Exotic' : 'Superior',
                    badgeTexte: complete ? '✓ Modèle Débloqué' : `🟥 ${prog} / ${max} Souvenirs`,
                    stats: extraireStatsObjet(armeMatch, null, null), perks: []
                };
                registreObjets[ukey] = objCraft;
                listeCrafting.push(objCraft);
            } else {
                listeTriomphes.push({
                    nom: nomRec, source: descRec || "Triomphe",
                    icone: def.displayProperties.icon ? 'https://www.bungie.net' + def.displayProperties.icon : 'https://www.bungie.net/img/misc/missing_icon_d2.png',
                    possede: complete, categorie: 'triumph', tier: complete ? 'Exotic' : 'Rare',
                    badgeTexte: complete ? 'Complété' : 'À faire'
                });
            }
        }

        listeCrafting.sort((a, b) => (a.possede !== b.possede ? (a.possede ? 1 : -1) : (b.progActuel / b.progMax) - (a.progActuel / a.progMax)));
        listeCatalyseurs.sort((a, b) => {
            const score = (x) => x.enCours ? 0 : (!x.possede ? 1 : 2);
            return score(a) !== score(b) ? score(a) - score(b) : (b.progActuel / b.progMax) - (a.progActuel / a.progMax);
        });

        document.getElementById('count-crafting').textContent = listeCrafting.length;
        document.getElementById('count-catalysts').textContent = listeCatalyseurs.length;
        document.getElementById('count-exotics').textContent = listeExotiques.length;
        document.getElementById('count-triumphs').textContent = listeTriomphes.length;

        const duree = ((performance.now() - t0) / 1000).toFixed(1);
        if (!resp.profileInventory?.data) {
            setStatus("⚠️ Clique sur 'Se connecter avec Bungie.net' en haut à droite pour accéder au Coffre.");
        } else {
            const hasRefresh = Boolean(localStorage.getItem('d2_refreshToken'));
            setStatus(`Synchronisé en ${duree}s — ${listeCoffre.length} objets au Coffre${hasRefresh ? ' • Session persistante 90j active' : ''}.`);
        }

        if (ongletActif === 'vendors') chargerMarchandsPerso(persoActifId);
        else {
            if (ongletActif === 'optimizer') calculerOptimisationArmures(false);
            afficherVue();
            mettreAJourComparateurUI();
        }
    } catch (err) {
        setStatus("Info : " + err.message);
    }
}

// =========================================================================
// OPTIMISEUR D'ARMURES
// =========================================================================
function collecterArmuresClasseActive() {
    const p = mapPersos[persoActifId];
    if (!p) return [];
    const tous = [];
    Object.values(mapPersos).forEach(ch => { tous.push(...ch.equipped, ...ch.inventory); });
    tous.push(...listeCoffre);
    return tous.filter(i =>
        i.categorie === 'armor' && i.itemInstanceId &&
        i.classType === p.classType && (i.tier === 'Exotic' || i.tier === 'Superior')
    );
}

function appliquerPresetOptimiseur(preset) {
    if (preset === 'triple_pve') optState.targets = [0, 10, 10, 10, 0, 0];
    else if (preset === 'res_dis') optState.targets = [0, 10, 0, 10, 0, 0];
    else if (preset === 'pvp_mob') optState.targets = [10, 7, 10, 0, 0, 0];
    else optState.targets = [0, 0, 0, 0, 0, 0];
    calculerOptimisationArmures(true);
}

function majParamOptimiseur() {
    const selExo = document.getElementById('optExotic');
    if (selExo) optState.exotic = selExo.value;
    for (let i = 0; i < 6; i++) {
        const el = document.getElementById('optStat_' + i);
        if (el) optState.targets[i] = parseInt(el.value, 10) || 0;
    }
    const cbMW = document.getElementById('optAssumeMW');
    const cbMods = document.getElementById('optUseMods');
    const cbJunk = document.getElementById('optIgnoreJunk');
    if (cbMW) optState.assumeMW = cbMW.checked;
    if (cbMods) optState.useMods = cbMods.checked;
    if (cbJunk) optState.ignoreJunk = cbJunk.checked;
    calculerOptimisationArmures(true);
}

function calculerOptimisationArmures(rerender = true) {
    const t0 = performance.now();
    const armures = collecterArmuresClasseActive().filter(a => !(optState.ignoreJunk && obtenirTag(a) === 'junk'));

    const classItems = armures.filter(a => a.bucketHash === BUCKET_CLASS_ITEM);
    classItems.sort((a, b) => (b.isMasterwork ? 1 : 0) - (a.isMasterwork ? 1 : 0) || (b.power || 0) - (a.power || 0));
    const bestClassItem = classItems[0] || null;
    const bonusClassItem = (bestClassItem && (bestClassItem.isMasterwork || optState.assumeMW)) ? 2 : 0;

    const exoChoisi = optState.exotic;
    let exoBucketVerrouille = null;
    if (exoChoisi !== 'any' && exoChoisi !== 'none') {
        const sampleExo = armures.find(a => String(a.itemHash) === exoChoisi);
        if (sampleExo) exoBucketVerrouille = sampleExo.bucketHash;
    }

    const targetsPts = optState.targets.map(t => t * 10);
    const maxMods = optState.useMods ? 5 : 0;

    const pools = ARMOR_SLOTS_4.map(bHash => {
        let candidates = armures.filter(a => a.bucketHash === bHash && a.armorStats6);
        if (exoChoisi === 'none') candidates = candidates.filter(a => a.tier !== 'Exotic');
        else if (exoBucketVerrouille !== null) {
            candidates = (bHash === exoBucketVerrouille)
                ? candidates.filter(a => String(a.itemHash) === exoChoisi)
                : candidates.filter(a => a.tier !== 'Exotic');
        }

        const enriched = candidates.map(a => {
            const addMW = (optState.assumeMW && !a.isMasterwork) ? 2 : 0;
            const vec = a.armorStats6.map(v => v + addMW);
            let scoreHeuristique = 0;
            for (let i = 0; i < 6; i++) scoreHeuristique += vec[i] * (optState.targets[i] > 0 ? (2 + optState.targets[i] * 0.25) : 0.7);
            return { item: a, vec, isExo: a.tier === 'Exotic', scoreHeuristique };
        });

        enriched.sort((a, b) => b.scoreHeuristique - a.scoreHeuristique);
        if (enriched.length > 16) return [...enriched.slice(0, 14), ...enriched.slice(14).filter(e => e.isExo).slice(0, 4)];
        return enriched;
    });

    if (pools.some(p => p.length === 0)) {
        optState.results = [];
        optState.meta = { totalTested: 0, exactFound: false, ms: Math.round(performance.now() - t0), missingSlot: true };
        if (rerender) afficherVue();
        return;
    }

    const ordrePriorite = [0, 1, 2, 3, 4, 5].sort((a, b) => optState.targets[b] - optState.targets[a]);
    let tested = 0, exactMatches = [], fallbackMatches = [];

    const [p0, p1, p2, p3] = pools;
    for (let i0 = 0; i0 < p0.length; i0++) {
        const a0 = p0[i0];
        for (let i1 = 0; i1 < p1.length; i1++) {
            const a1 = p1[i1];
            const exo01 = (a0.isExo ? 1 : 0) + (a1.isExo ? 1 : 0);
            if (exo01 > 1) continue;
            for (let i2 = 0; i2 < p2.length; i2++) {
                const a2 = p2[i2];
                const exo012 = exo01 + (a2.isExo ? 1 : 0);
                if (exo012 > 1) continue;
                for (let i3 = 0; i3 < p3.length; i3++) {
                    const a3 = p3[i3];
                    if (exo012 + (a3.isExo ? 1 : 0) > 1) continue;
                    tested++;

                    const base = [
                        a0.vec[0] + a1.vec[0] + a2.vec[0] + a3.vec[0] + bonusClassItem,
                        a0.vec[1] + a1.vec[1] + a2.vec[1] + a3.vec[1] + bonusClassItem,
                        a0.vec[2] + a1.vec[2] + a2.vec[2] + a3.vec[2] + bonusClassItem,
                        a0.vec[3] + a1.vec[3] + a2.vec[3] + a3.vec[3] + bonusClassItem,
                        a0.vec[4] + a1.vec[4] + a2.vec[4] + a3.vec[4] + bonusClassItem,
                        a0.vec[5] + a1.vec[5] + a2.vec[5] + a3.vec[5] + bonusClassItem
                    ];

                    let modsUsed = 0, deficitRestant = 0;
                    const modsParStat = [0, 0, 0, 0, 0, 0];
                    const modsDetail = [];

                    for (let s = 0; s < 6; s++) {
                        const def = targetsPts[s] - base[s];
                        if (def > 0) {
                            const slotsReq = Math.ceil(def / 10);
                            modsUsed += slotsReq;
                            modsParStat[s] = (def % 10 > 0 && def % 10 <= 5) ? ((slotsReq - 1) * 10 + 5) : (slotsReq * 10);
                        }
                    }

                    const respecteCibles = modsUsed <= maxMods;
                    const finalStats = base.slice();

                    if (respecteCibles) {
                        for (let s = 0; s < 6; s++) {
                            if (modsParStat[s] > 0) {
                                finalStats[s] += modsParStat[s];
                                const maj = Math.floor(modsParStat[s] / 10);
                                const min = (modsParStat[s] % 10) === 5 ? 1 : 0;
                                if (maj > 0) modsDetail.push(`${maj}× +10 ${STATS_GARDIEN_6[s].nom}`);
                                if (min > 0) modsDetail.push(`1× +5 ${STATS_GARDIEN_6[s].nom}`);
                            }
                        }
                        let restants = maxMods - modsUsed;
                        while (restants > 0) {
                            let bestS = -1;
                            for (const s of ordrePriorite) { if (finalStats[s] < 100) { bestS = s; break; } }
                            if (bestS === -1) break;
                            const gain = (100 - finalStats[bestS]) <= 5 ? 5 : 10;
                            finalStats[bestS] += gain;
                            modsDetail.push(`1× +${gain} ${STATS_GARDIEN_6[bestS].nom}`);
                            restants--;
                        }
                    } else {
                        for (let s = 0; s < 6; s++) { if (targetsPts[s] > base[s]) deficitRestant += (targetsPts[s] - base[s]); }
                    }

                    let totalTiers = 0, wasted = 0;
                    for (let s = 0; s < 6; s++) {
                        const v = finalStats[s];
                        totalTiers += Math.min(10, Math.floor(v / 10));
                        wasted += v >= 100 ? (v - 100) : (v % 10);
                    }

                    const entry = {
                        pieces: [a0.item, a1.item, a2.item, a3.item, bestClassItem].filter(Boolean),
                        finalStats, totalTiers, wasted, modsUsed, modsDetail, exact: respecteCibles,
                        score: respecteCibles ? (totalTiers * 10000 - modsUsed * 200 - wasted * 5) : (-deficitRestant * 1000 + totalTiers * 100 - wasted)
                    };

                    if (respecteCibles) {
                        if (exactMatches.length < 15) { exactMatches.push(entry); exactMatches.sort((a, b) => b.score - a.score); }
                        else if (entry.score > exactMatches[exactMatches.length - 1].score) { exactMatches[exactMatches.length - 1] = entry; exactMatches.sort((a, b) => b.score - a.score); }
                    } else if (exactMatches.length === 0) {
                        if (fallbackMatches.length < 10) { fallbackMatches.push(entry); fallbackMatches.sort((a, b) => b.score - a.score); }
                        else if (entry.score > fallbackMatches[fallbackMatches.length - 1].score) { fallbackMatches[fallbackMatches.length - 1] = entry; fallbackMatches.sort((a, b) => b.score - a.score); }
                    }
                }
            }
        }
    }

    optState.results = exactMatches.length > 0 ? exactMatches : fallbackMatches;
    optState.meta = { totalTested: tested, exactFound: exactMatches.length > 0, ms: Math.round(performance.now() - t0), missingSlot: false };
    if (rerender) afficherVue();
}

function equiperEnsembleOptimise(idx) {
    const set = optState.results[idx];
    if (!set || !persoActifId) return;
    const nomPerso = mapPersos[persoActifId]?.classeNom || 'Perso';
    const pieces = [...set.pieces].sort((a, b) => (a.tier === 'Exotic' ? 1 : 0) - (b.tier === 'Exotic' ? 1 : 0));

    enfilerAction(`Équipement de l'ensemble T${set.totalTiers} sur ${nomPerso}...`, pieces.map(p => p.itemInstanceId), async () => {
        for (const piece of pieces) {
            const live = registreObjets[piece.itemInstanceId];
            if (live) await apiEquiperDirect(live, persoActifId);
        }
        return { statsChanged: true, msg: `✓ Ensemble T${set.totalTiers} équipé sur ${nomPerso} !` };
    });
}

function sauvegarderSetOptimiseEnBuild(idx) {
    const set = optState.results[idx];
    const p = mapPersos[persoActifId];
    if (!set || !p) return;
    const exo = set.pieces.find(x => x.tier === 'Exotic');
    const nom = `Opti T${set.totalTiers}${exo ? ' — ' + exo.nom : ''}`;
    const armesActuelles = p.equipped.filter(i => i.categorie === 'weapon');
    const itemsBuild = [...armesActuelles, ...set.pieces].map(item => ({
        itemHash: item.itemHash, itemInstanceId: item.itemInstanceId, bucketHash: item.bucketHash, nom: item.nom
    }));
    const builds = chargerBuildsLocale();
    builds.push({ id: Date.now(), nom, items: itemsBuild });
    localStorage.setItem(getCleBuilds(), JSON.stringify(builds));
    setStatus(`Ensemble sauvegardé dans tes Builds : "${nom}"`);
}

function rendreVueOptimiseur() {
    const p = mapPersos[persoActifId];
    if (!p) return `<p style="color:#64748b;">Connecte-toi avec Bungie.net pour optimiser tes armures.</p>`;

    const armuresClasse = collecterArmuresClasseActive();
    const mapExos = {};
    armuresClasse.filter(a => a.tier === 'Exotic' && a.bucketHash !== BUCKET_CLASS_ITEM).forEach(a => {
        if (!mapExos[a.itemHash]) mapExos[a.itemHash] = { nom: a.nom, type: a.typeNom, count: 0 };
        mapExos[a.itemHash].count++;
    });
    const exosTries = Object.entries(mapExos).sort((a, b) => a[1].nom.localeCompare(b[1].nom, 'fr'));

    const optionsExosHtml = `
        <option value="any" ${optState.exotic === 'any' ? 'selected' : ''}>Exotique : Automatique (0 ou 1 max)</option>
        <option value="none" ${optState.exotic === 'none' ? 'selected' : ''}>Légendaires uniquement</option>
        ${exosTries.map(([h, info]) => `<option value="${h}" ${optState.exotic === h ? 'selected' : ''}>★ ${info.nom} (${info.type} ×${info.count})</option>`).join('')}
    `;

    const statSelectorsHtml = STATS_GARDIEN_6.map((st, idx) => `
        <div class="opt-stat-box">
            <label for="optStat_${idx}">${st.nom}</label>
            <select id="optStat_${idx}" onchange="majParamOptimiseur()">
                ${[0,1,2,3,4,5,6,7,8,9,10].map(t => `<option value="${t}" ${optState.targets[idx] === t ? 'selected' : ''}>${t === 0 ? 'Libre' : `Min T${t} (${t*10})`}</option>`).join('')}
            </select>
        </div>
    `).join('');

    let resultsHtml = '';
    if (!optState.meta) {
        resultsHtml = `<p style="color:#94a3b8;">Clique sur <b>⚡ Calculer les combinaisons</b> pour analyser tes ${armuresClasse.length} pièces d'armure.</p>`;
    } else if (optState.meta.missingSlot) {
        resultsHtml = `<p style="color:#f87171;">Aucune armure disponible pour l'un des 4 emplacements.</p>`;
    } else {
        const banniereInfo = optState.meta.exactFound
            ? `<div style="margin-bottom:12px; font-size:0.84rem; color:#86efac;">✓ ${optState.meta.totalTested.toLocaleString('fr-FR')} combinaisons analysées en ${optState.meta.ms} ms</div>`
            : `<div style="margin-bottom:12px; font-size:0.84rem; color:#fdba74;">⚠️ Aucun ensemble n'atteint exactement tous ces paliers (${optState.meta.totalTested.toLocaleString('fr-FR')} testées). Combinaisons les plus proches :</div>`;

        resultsHtml = banniereInfo + `<div class="opt-results-list">` + optState.results.map((res, idx) => {
            const statsPills = STATS_GARDIEN_6.map((st, sIdx) => {
                const val = res.finalStats[sIdx];
                const tier = Math.min(10, Math.floor(val / 10));
                const hitTarget = optState.targets[sIdx] > 0 && tier >= optState.targets[sIdx];
                return `<div class="opt-stat-pill ${tier === 10 ? 't10' : (hitTarget ? 'target-ok' : '')}"><small>${st.court}</small><b>T${tier}</b><small style="color:#64748b;">${val}</small></div>`;
            }).join('');

            const modsTexte = res.modsDetail.length > 0
                ? `Mods conseillés : ${res.modsDetail.join(' • ')}`
                : (optState.useMods ? 'Aucun mod de stat requis' : 'Sans mods de stats');

            return `
                <div class="opt-set-card ${res.exact ? 'perfect' : ''}">
                    <div>
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <b style="font-size:1rem; color:var(--light);">#${idx + 1} — Total T${res.totalTiers}</b>
                            <span class="badge">${res.wasted} pts perdus</span>
                            ${res.exact ? `<span class="badge badge-done">✓ Objectifs atteints</span>` : ''}
                        </div>
                        <div class="opt-set-stats">${statsPills}</div>
                        <div class="opt-mods-note">${modsTexte}</div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">${res.pieces.map(rendreTuile).join('')}</div>
                    <div style="display:flex; flex-direction:column; gap:6px; min-width:155px;">
                        <button class="btn-green" onclick="equiperEnsembleOptimise(${idx})">⚡ Équiper cet ensemble</button>
                        <button class="btn-compare" onclick="sauvegarderSetOptimiseEnBuild(${idx})">💾 Sauver en Build</button>
                    </div>
                </div>
            `;
        }).join('') + `</div>`;
    }

    return `
        <div class="opt-controls">
            <div class="opt-top-row">
                <h3 style="margin:0; font-size:1.02rem; color:#ffffff; text-transform:uppercase; letter-spacing:1px;">🛡️ Optimiseur d'Armures — ${p.classeNom} (${armuresClasse.length} pièces)</h3>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <select id="optExotic" onchange="majParamOptimiseur()" style="min-width:260px;">${optionsExosHtml}</select>
                    <button class="btn-ghost" onclick="appliquerPresetOptimiseur('triple_pve')">Triple 100 PvE</button>
                    <button class="btn-ghost" onclick="appliquerPresetOptimiseur('res_dis')">Rés/Disc T10</button>
                    <button class="btn-ghost" onclick="appliquerPresetOptimiseur('pvp_mob')">PvP Mob/Réc</button>
                    <button class="btn-ghost" onclick="appliquerPresetOptimiseur('reset')">↺ Zéro</button>
                </div>
            </div>
            <div class="opt-stats-inputs">${statSelectorsHtml}</div>
            <div class="opt-options-row">
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <label class="opt-check"><input type="checkbox" id="optAssumeMW" ${optState.assumeMW ? 'checked' : ''} onchange="majParamOptimiseur()"> Supposer Pièce Maîtresse (+12/pièce)</label>
                    <label class="opt-check"><input type="checkbox" id="optUseMods" ${optState.useMods ? 'checked' : ''} onchange="majParamOptimiseur()"> Inclure Mods de stats (+50 pts max)</label>
                    <label class="opt-check"><input type="checkbox" id="optIgnoreJunk" ${optState.ignoreJunk ? 'checked' : ''} onchange="majParamOptimiseur()"> Ignorer les armures 🗑️ À démanteler</label>
                </div>
                <button class="btn-green" onclick="majParamOptimiseur()">⚡ Calculer les combinaisons</button>
            </div>
        </div>
        ${resultsHtml}
    `;
}

// =========================================================================
// COMPARATEUR CÔTE-À-CÔTE
// =========================================================================
function basculerComparateur() { document.getElementById('compareDrawer').classList.toggle('open'); mettreAJourComparateurUI(); }
function fermerComparateur() { document.getElementById('compareDrawer').classList.remove('open'); }
function viderComparateur() { comparateurKeys = []; mettreAJourComparateurUI(); afficherVue(); }

function ajouterAuComparateur(ukey, ouvrir = true) {
    fermerInspecteur(true);
    if (!registreObjets[ukey]) return;
    if (!comparateurKeys.includes(ukey)) comparateurKeys.push(ukey);
    if (ouvrir) document.getElementById('compareDrawer').classList.add('open');
    mettreAJourComparateurUI();
    afficherVue();
}

function retirerDuComparateur(ukey) {
    comparateurKeys = comparateurKeys.filter(k => k !== ukey);
    if (comparateurKeys.length === 0) fermerComparateur();
    mettreAJourComparateurUI();
    afficherVue();
}

function comparerDoublonsObjet(itemHash) {
    fermerInspecteur(true);
    const copies = Object.values(registreObjets).filter(o => o.itemHash === itemHash && o.itemInstanceId);
    copies.sort((a, b) => (b.power || 0) - (a.power || 0));
    comparateurKeys = copies.map(c => c.ukey);
    document.getElementById('compareDrawer').classList.add('open');
    mettreAJourComparateurUI();
    afficherVue();
}

function comparerMemeTypeObjet(ukey) {
    fermerInspecteur(true);
    const ref = registreObjets[ukey];
    if (!ref) return;
    const memesTypes = Object.values(registreObjets).filter(o => o.itemInstanceId && o.typeNom === ref.typeNom && o.bucketHash === ref.bucketHash);
    memesTypes.sort((a, b) => (b.power || 0) - (a.power || 0));
    comparateurKeys = memesTypes.slice(0, 12).map(c => c.ukey);
    document.getElementById('compareDrawer').classList.add('open');
    mettreAJourComparateurUI();
    afficherVue();
}

function libelleLieu(item) {
    if (item.lieuType === 'vault') return '🏦 Coffre';
    if (item.lieuType === 'postmaster') return '📬 Commis';
    const cls = mapPersos[item.charIdOwner]?.classeNom || 'Perso';
    return item.lieuType === 'equipped' ? `⚡ Équipé (${cls})` : `🎒 Sac (${cls})`;
}

function rendreBoutonsTags(item, compact = false) {
    if (!item.itemInstanceId) return '';
    const cur = obtenirTag(item);
    return Object.values(TAGS_CONFIG).map(t => `
        <button class="tag-btn ${cur === t.id ? 'active-' + t.id : ''}"
                onclick="definirTag('${item.itemInstanceId}', '${t.id}')" title="${t.label}">
            ${t.icon}${compact ? '' : ' ' + t.label}
        </button>
    `).join('');
}

function mettreAJourComparateurUI() {
    const items = comparateurKeys.map(k => registreObjets[k]).filter(Boolean);
    document.getElementById('count-compare').textContent = items.length;
    document.getElementById('compareHeaderCount').textContent = items.length;
    document.getElementById('btnOpenCompare').classList.toggle('has-items', items.length > 0);

    const conteneur = document.getElementById('compareContent');
    if (items.length === 0) {
        conteneur.innerHTML = `<p style="color:#64748b; font-size:0.86rem; margin:10px 0;">Clique sur une arme ou armure puis sur <b>⚖️ + Comparer</b> pour comparer leurs stats et perks.</p>`;
        return;
    }

    const statsMetaMap = new Map();
    items.forEach(it => (it.stats || []).forEach(s => { if (!statsMetaMap.has(s.hash)) statsMetaMap.set(s.hash, s); }));
    const ordreGlobal = [...STATS_ARMES_ORDRE, ...STATS_ARMURES_ORDRE, 0];
    const toutesStats = Array.from(statsMetaMap.values()).sort((a, b) => {
        const ia = ordreGlobal.indexOf(a.hash), ib = ordreGlobal.indexOf(b.hash);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    const bornesStats = {};
    toutesStats.forEach(st => {
        const vals = items.map(it => (it.stats || []).find(x => x.hash === st.hash)?.val).filter(v => v !== undefined);
        if (vals.length >= 2) {
            const min = Math.min(...vals), max = Math.max(...vals);
            if (min !== max) {
                const bas = STATS_BAS_MEILLEUR.has(st.hash);
                bornesStats[st.hash] = { best: bas ? min : max, worst: bas ? max : min };
            }
        }
    });

    const nomPersoActif = mapPersos[persoActifId]?.classeNom || 'Perso';
    conteneur.innerHTML = items.map(item => {
        const statsRowsHtml = toutesStats.map(st => {
            const found = (item.stats || []).find(x => x.hash === st.hash);
            const val = found ? found.val : null;
            let clsDiff = '';
            if (val !== null && bornesStats[st.hash]) {
                if (val === bornesStats[st.hash].best) clsDiff = 'cmp-best';
                else if (val === bornesStats[st.hash].worst) clsDiff = 'cmp-worst';
            }
            return `
                <div class="cmp-stat-row ${clsDiff}">
                    <span style="color:${st.isTotal ? 'var(--light)' : '#98a2ad'}; font-weight:${st.isTotal ? '700' : '400'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${st.nom}</span>
                    ${st.isBar && val !== null ? `<div class="cmp-stat-bar"><div class="cmp-stat-fill" style="width:${Math.min(100, val)}%;"></div></div>` : `<span></span>`}
                    <span class="cmp-stat-val">${val !== null ? val : '—'}</span>
                </div>
            `;
        }).join('');

        const perksHtml = (item.perks || []).length > 0
            ? item.perks.map(p => `<div class="cmp-perk-row" title="${(p.desc || '').replace(/"/g, '&quot;')}">${p.icone ? `<img src="${p.icone}">` : ''}<span>${p.nom}</span></div>`).join('')
            : `<small style="color:#475569; font-size:0.74rem;">Aucun perk affiché</small>`;

        let actionsHtml = '';
        if (item.itemInstanceId && item.lieuType !== 'postmaster') {
            actionsHtml = `
                <div class="compare-col-tags">${rendreBoutonsTags(item, true)}</div>
                <div class="compare-col-actions">
                    ${item.lieuType !== 'equipped' ? `<button class="btn-green" onclick="executerMouvement('equipped', ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', '${item.charIdOwner || ''}')">⚡ Équiper</button>` : ''}
                    ${item.lieuType === 'vault' ? `<button onclick="executerMouvement('inventory', ${item.itemHash}, '${item.itemInstanceId}', 'vault', '')">🎒 Sac ${nomPersoActif}</button>` : ''}
                    ${item.lieuType === 'inventory' ? `<button onclick="executerMouvement('vault', ${item.itemHash}, '${item.itemInstanceId}', 'inventory', '${item.charIdOwner || ''}')">🏦 Coffre</button>` : ''}
                </div>
            `;
        }

        return `
            <div class="compare-col tier-${item.tier} ${busyItems.has(item.itemInstanceId) ? 'tile-busy' : ''}">
                <div class="compare-col-head">
                    <img src="${item.icone}">
                    <div class="compare-col-title">
                        <h4 title="${item.nom}">${item.nom}</h4>
                        <small>${rendreElementInline(item, false)} ${item.typeNom} ${item.power ? `• <b style="color:var(--light);">✦ ${item.power}</b>` : ''}</small>
                        <small style="color:#b8c7d6;">${libelleLieu(item)}</small>
                    </div>
                    <button class="compare-remove" onclick="retirerDuComparateur('${item.ukey}')" title="Retirer">✕</button>
                </div>
                <div class="compare-stats-list">${statsRowsHtml || '<small style="color:#64748b;">Aucune stat</small>'}</div>
                <div class="compare-perks-list">${perksHtml}</div>
                ${actionsHtml}
            </div>
        `;
    }).join('');
}

// =========================================================================
// STATS GLOBALES, BUILDS, POSTMASTER & INSPECTEUR
// =========================================================================
function mettreAJourCompteurJalons() {
    const p = mapPersos[persoActifId];
    document.getElementById('count-milestones').textContent = (p?.milestones || []).filter(m => !m.possede).length;
}

function afficherStatsGlobalesGardien() {
    const panel = document.getElementById('guardianStatsPanel');
    const p = mapPersos[persoActifId];
    if (!p || ongletActif !== 'loadout') { panel.style.display = 'none'; return; }
    panel.style.display = 'grid';

    panel.innerHTML = STATS_GARDIEN_6.map(st => {
        const val = p.statsGlobales[st.hash] || 0;
        const tier = Math.min(10, Math.floor(val / 10));
        const perdu = val >= 100 ? (val - 100) : (val % 10);
        let segs = '';
        for (let i = 1; i <= 10; i++) segs += `<div class="g-seg ${i <= tier ? 'filled' : ''}"></div>`;
        return `
            <div class="g-stat-card ${tier === 10 ? 'tier-10' : ''}">
                <div class="g-stat-header">
                    <span class="g-stat-name">${st.nom} (${val})</span>
                    <span class="g-stat-tier">T${tier}</span>
                </div>
                <div class="g-stat-segments">${segs}</div>
                <div class="g-stat-sub">
                    <span>Actif : ${tier * 10}</span>
                    ${perdu > 0 ? `<span class="waste-warn">+${perdu} perdus</span>` : `<span style="color:var(--green);">✓ Optimal</span>`}
                </div>
            </div>
        `;
    }).join('');
}

function getCleBuilds() { return `d2_builds_${persoActifId || 'default'}`; }
function chargerBuildsLocale() {
    try { return JSON.parse(localStorage.getItem(getCleBuilds()) || '[]'); }
    catch { return []; }
}

function sauvegarderBuildActuel() {
    const p = mapPersos[persoActifId];
    if (!p || p.equipped.length === 0) return;
    const champNom = document.getElementById('nomNouveauBuild');
    const nom = champNom.value.trim() || `Build ${p.classeNom} (${p.light})`;
    const itemsBuild = p.equipped.map(item => ({
        itemHash: item.itemHash, itemInstanceId: item.itemInstanceId, bucketHash: item.bucketHash, nom: item.nom
    }));
    const builds = chargerBuildsLocale();
    builds.push({ id: Date.now(), nom, items: itemsBuild });
    localStorage.setItem(getCleBuilds(), JSON.stringify(builds));
    champNom.value = "";
    afficherBarreBuilds();
    setStatus(`Build "${nom}" sauvegardé !`);
}

function supprimerBuild(id) {
    localStorage.setItem(getCleBuilds(), JSON.stringify(chargerBuildsLocale().filter(b => b.id !== id)));
    afficherBarreBuilds();
}

function equiperBuildComplet(id) {
    const build = chargerBuildsLocale().find(b => b.id === id);
    if (!build || !persoActifId) return;
    const ids = build.items.map(i => i.itemInstanceId);

    enfilerAction(`Équipement du Build "${build.nom}"...`, ids, async () => {
        const liveItems = build.items.map(b => registreObjets[b.itemInstanceId]).filter(Boolean);
        liveItems.sort((a, b) => (a.tier === 'Exotic' ? 1 : 0) - (b.tier === 'Exotic' ? 1 : 0));
        for (const item of liveItems) await apiEquiperDirect(item, persoActifId);
        return { statsChanged: true, msg: `✓ Build "${build.nom}" équipé !` };
    });
}

function afficherBarreBuilds() {
    const bar = document.getElementById('buildsBar');
    const zone = document.getElementById('listeBuildsChips');
    if (!persoActifId || ongletActif !== 'loadout') { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const builds = chargerBuildsLocale();
    if (builds.length === 0) {
        zone.innerHTML = `<small style="color:#64748b;">Aucun build enregistré.</small>`;
        return;
    }
    zone.innerHTML = builds.map(b => `
        <div class="build-chip">
            <b title="${b.items.map(i => i.nom).join(' • ')}">${b.nom}</b>
            <button onclick="equiperBuildComplet(${b.id})">⚡ Équiper</button>
            <button class="btn-ghost" onclick="supprimerBuild(${b.id})">✕</button>
        </div>
    `).join('');
}

function afficherPostmaster() {
    const box = document.getElementById('postmasterBox');
    const p = mapPersos[persoActifId];
    if (!p || ongletActif !== 'loadout' || p.postmaster.length === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <b style="color:#e9d5ff; font-size:0.9rem;">📬 Commis des postes (${p.postmaster.length} / 21)</b>
            <button class="btn-green" onclick="toutRecupererDuPostmaster()">📥 Tout récupérer</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">${p.postmaster.map(rendreTuile).join('')}</div>
    `;
}

function rendreContenuInspecteur(item) {
    const insp = document.getElementById('itemInspector');
    const statsHtml = (item.stats || []).map(s => `
        <div class="insp-stat-row">
            <span style="color:${s.isTotal ? 'var(--light)' : '#cfd6de'}; font-weight:${s.isTotal ? '700' : '400'};">${s.nom}</span>
            ${s.isBar ? `<div class="insp-stat-bar"><div class="insp-stat-fill" style="width:${Math.min(100, s.val)}%;"></div></div>` : `<span></span>`}
            <span style="text-align:right; font-weight:700; color:${s.isTotal ? 'var(--light)' : '#fff'};">${s.val}</span>
        </div>
    `).join('');

    const perksHtml = (item.perks || []).map(p => `
        <div class="insp-perk-item">
            ${p.icone ? `<img src="${p.icone}">` : ''}
            <div><b>${p.nom}</b><span>${p.desc.substring(0, 110)}</span></div>
        </div>
    `).join('');

    let tagsRowHtml = '';
    let actionsHtml = '';
    if (inspecteurVerrouille) {
        if (item.itemInstanceId) tagsRowHtml = `<div class="tag-selector-row">${rendreBoutonsTags(item, false)}</div>`;

        const nomPerso = mapPersos[persoActifId]?.classeNom || 'Perso';
        const estDansComp = comparateurKeys.includes(item.ukey);
        const nbCopies = compteDoublons[item.itemHash] || 0;

        const btnComparer = (item.stats && item.stats.length > 0)
            ? `<button class="btn-compare" onclick="ajouterAuComparateur('${item.ukey}', true)">${estDansComp ? '⚖️ Voir Comparateur' : '⚖️ + Comparer'}</button>` : '';
        const btnCompCopies = (nbCopies > 1 && item.itemInstanceId)
            ? `<button class="btn-compare" onclick="comparerDoublonsObjet(${item.itemHash})">⚖️ Comparer ×${nbCopies} copies</button>`
            : (item.categorie === 'weapon' && item.itemInstanceId
                ? `<button class="btn-compare" onclick="comparerMemeTypeObjet('${item.ukey}')">⚖️ Tous les ${item.typeNom}s</button>` : '');

        if (item.lieuType === 'postmaster') {
            actionsHtml = `
                <div class="insp-actions">
                    <button class="btn-green" onclick="recupererDuPostmaster(${item.itemHash}, '${item.itemInstanceId}', ${item.stackSize})">📥 Récupérer</button>
                    ${btnComparer}
                    <button class="btn-ghost" onclick="fermerInspecteur(true)">✕ Fermer</button>
                </div>
            `;
        } else if (item.itemInstanceId) {
            let autresPersosHtml = Object.entries(mapPersos)
                .filter(([cId, p]) => {
                    if (cId === (item.charIdOwner || '') && item.lieuType === 'inventory') return false;
                    if (item.lieuType === 'vault' && cId === persoActifId) return false;
                    if (item.categorie === 'armor' && item.classType !== 3 && item.classType !== p.classType) return false;
                    return true;
                })
                .map(([cId, p]) => `<button onclick="transfererVersAutrePerso(${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', '${item.charIdOwner || ''}', '${cId}')">➔ ${p.classeNom}</button>`)
                .join('');

            actionsHtml = `
                <div class="insp-actions">
                    ${!(item.lieuType === 'equipped' && item.charIdOwner === persoActifId) ? `<button class="btn-green" onclick="executerMouvement('equipped', ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', '${item.charIdOwner || ''}')">⚡ Équiper (${nomPerso})</button>` : ''}
                    ${item.lieuType !== 'inventory' || item.charIdOwner !== persoActifId ? `<button onclick="executerMouvement('inventory', ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', '${item.charIdOwner || ''}')">🎒 Sac (${nomPerso})</button>` : ''}
                    ${item.lieuType !== 'vault' ? `<button onclick="executerMouvement('vault', ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', '${item.charIdOwner || ''}')">🏦 Coffre</button>` : ''}
                    ${autresPersosHtml}
                    ${btnComparer}
                    ${btnCompCopies}
                    <button class="btn-ghost" onclick="fermerInspecteur(true)">✕ Fermer</button>
                </div>
            `;
        } else {
            actionsHtml = `<div class="insp-actions">${btnComparer}<button class="btn-ghost" onclick="fermerInspecteur(true)">✕ Fermer</button></div>`;
        }
    }

    const tagActuel = obtenirTag(item);
    const tagPillHeader = tagActuel ? `<span class="badge" style="background:${TAGS_CONFIG[tagActuel].bg}; border:1px solid ${TAGS_CONFIG[tagActuel].border}; color:#fff; margin-top:3px;">${TAGS_CONFIG[tagActuel].icon} ${TAGS_CONFIG[tagActuel].label}</span>` : '';
    const elemHeaderHtml = item.element ? ` • ${rendreElementInline(item, true)}` : '';

    insp.innerHTML = `
        <div class="insp-banner tier-${item.tier}">
            <img class="insp-icon" src="${item.icone}">
            <div class="insp-title">
                <h3>${item.nom}</h3>
                <small>${item.typeNom}${elemHeaderHtml}${item.isMasterwork ? ' • ★ PM' : ''}</small>
                ${tagPillHeader}
            </div>
            ${item.power ? `<div class="insp-power">✦ ${item.power}</div>` : ''}
        </div>
        <div class="insp-body">
            ${item.flavor ? `<p class="insp-flavor">"${item.flavor}"</p>` : ''}
            ${statsHtml || '<small style="color:#64748b;">Aucune statistique chiffrée.</small>'}
            ${perksHtml}
            ${tagsRowHtml}
            ${actionsHtml}
        </div>
    `;
}

function afficherInspecteur(ev, ukey, verrouiller = false) {
    if (inspecteurVerrouille && !verrouiller) return;
    const item = registreObjets[ukey];
    if (!item) return;
    if (verrouiller) { ev.stopPropagation(); inspecteurVerrouille = true; }
    inspecteurUkeyActif = ukey;
    const insp = document.getElementById('itemInspector');
    insp.classList.toggle('pinned', inspecteurVerrouille);
    rendreContenuInspecteur(item);
    insp.style.display = 'block';
    positionnerInspecteur(ev);
}

function positionnerInspecteur(ev) {
    const insp = document.getElementById('itemInspector');
    if (insp.style.display === 'none') return;
    const pad = 16;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const rect = insp.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 12) x = ev.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 12) y = Math.max(12, window.innerHeight - rect.height - 12);
    insp.style.left = x + 'px';
    insp.style.top = y + 'px';
}

function bougerInspecteur(ev) { if (!inspecteurVerrouille) positionnerInspecteur(ev); }

function fermerInspecteur(force = false) {
    if (inspecteurVerrouille && !force) return;
    inspecteurVerrouille = false;
    inspecteurUkeyActif = null;
    const insp = document.getElementById('itemInspector');
    insp.style.display = 'none';
    insp.classList.remove('pinned');
}

// =========================================================================
// NAVIGATION, BANNIÈRES D'EMBLÈMES, MARCHANDS & GLISSER-DÉPOSER
// =========================================================================
function selectionnerPerso(charId) {
    persoActifId = charId;
    optState.exotic = 'any';
    afficherBarrePersos();
    mettreAJourCompteurJalons();
    if (ongletActif === 'vendors') chargerMarchandsPerso(charId);
    else if (ongletActif === 'optimizer') calculerOptimisationArmures(true);
    else afficherVue();
}

function afficherBarrePersos() {
    const bar = document.getElementById('charBar');
    bar.innerHTML = Object.entries(mapPersos).map(([cId, p]) => {
        const hasBg = !!p.emblemBg;
        const bgStyle = hasBg
            ? `style="background-image: linear-gradient(90deg, rgba(10,14,20,0.05) 0%, rgba(10,14,20,0.42) 28%, rgba(10,14,20,0.82) 100%), url('${p.emblemBg}');"`
            : '';
        return `
            <div class="char-card ${hasBg ? 'has-banner' : ''} ${cId === persoActifId ? 'active' : ''}"
                 ${bgStyle}
                 onclick="selectionnerPerso('${cId}')"
                 ondragover="onDragOverZone(event)"
                 ondragleave="onDragLeaveZone(event)"
                 ondrop="onDropSurPerso(event, '${cId}')">
                ${!hasBg && p.emblem ? `<img class="char-emblem" src="${p.emblem}">` : ''}
                <div class="char-meta">
                    <h4>${p.classeNom}</h4>
                    <span>✦ ${p.light}</span>
                </div>
            </div>
        `;
    }).join('');
}

function changerOnglet(onglet) {
    ongletActif = onglet;
    ['loadout', 'optimizer', 'milestones', 'crafting', 'catalysts', 'vendors', 'quests', 'exotics', 'triumphs'].forEach(t => {
        document.getElementById('btn-' + t).classList.toggle('active', t === onglet);
    });

    document.getElementById('globalFiltersBar').style.display = onglet === 'optimizer' ? 'none' : 'flex';
    document.getElementById('btnFiltreDoublons').style.display = onglet === 'loadout' ? 'inline-block' : 'none';
    document.getElementById('filtreTag').style.display = onglet === 'loadout' ? 'inline-block' : 'none';
    document.getElementById('filtreMarchand').style.display = onglet === 'vendors' ? 'inline-block' : 'none';
    document.getElementById('filtreEtat').style.display = ['milestones', 'crafting', 'catalysts', 'exotics', 'triumphs'].includes(onglet) ? 'inline-block' : 'none';
    document.getElementById('filtreCategorie').style.display = onglet === 'milestones' ? 'none' : 'inline-block';

    mettreAJourOptionsTags();
    if (onglet === 'vendors' && Object.keys(groupesMarchands).length === 0 && persoActifId) chargerMarchandsPerso(persoActifId);
    else if (onglet === 'optimizer') calculerOptimisationArmures(true);
    else afficherVue();
}

async function chargerMarchandsPerso(charId) {
    const accessToken = await obtenirTokenValide();
    if (!accessToken || !joueurInfo) {
        setStatus("Clique sur 'Se connecter avec Bungie.net' pour inspecter les Marchands.");
        return;
    }
    try {
        setStatus(`Chargement des Marchands pour ${mapPersos[charId].classeNom}...`);
        const url = `https://www.bungie.net/Platform/Destiny2/${joueurInfo.membershipType}/Profile/${joueurInfo.membershipId}/Character/${charId}/Vendors/?components=400,402,300,302,304`;
        const resp = await fetch(url, { headers: { 'X-API-Key': DEFAULT_API_KEY, 'Authorization': `Bearer ${accessToken}` } });
        const data = await resp.json();

        const vendorsData = data.Response?.vendors?.data || {};
        const salesData = data.Response?.sales?.data || {};
        const vendorStats = data.Response?.itemComponents || {};
        groupesMarchands = {};
        let totalObjets = 0;

        for (const vHash in salesData) {
            if (!vendorsData[vHash]) continue;
            const vDef = dictGlobal.vendors[vHash];
            if (!vDef || !vDef.displayProperties?.name) continue;

            const nomMarchand = vDef.displayProperties.name;
            const iconeMarchand = vDef.displayProperties.icon ? 'https://www.bungie.net' + vDef.displayProperties.icon : '';
            const descMarchand = vDef.displayProperties.subtitle || vDef.displayProperties.description || "";
            const statsMarchand = vendorStats[vHash]?.stats?.data || {};
            const perksMarchand = vendorStats[vHash]?.perks?.data || {};
            const instMarchand = vendorStats[vHash]?.instances?.data || {};

            const armes = [], armures = [], autres = [];
            const dejaVu = new Set();

            for (const [sKey, sItem] of Object.entries(salesData[vHash].saleItems || {})) {
                const itemDef = dictGlobal.items[sItem.itemHash];
                if (!itemDef || !itemDef.displayProperties?.name) continue;
                if (dejaVu.has(itemDef.displayProperties.name)) continue;
                if (![2, 3, 12, 19].includes(itemDef.itemType) && itemDef.inventory?.tierType < 5) continue;

                dejaVu.add(itemDef.displayProperties.name);
                const tierKey = itemDef.inventory?.tierType === 6 ? 'Exotic' : (itemDef.inventory?.tierType === 5 ? 'Superior' : 'Rare');
                const ukey = `vendor_${vHash}_${sKey}`;

                const obj = {
                    ukey,
                    nom: itemDef.displayProperties.name,
                    typeNom: itemDef.itemTypeDisplayName || "Offre Marchand",
                    flavor: itemDef.flavorText || "",
                    source: itemDef.itemTypeDisplayName || "Objet",
                    icone: itemDef.displayProperties.icon ? 'https://www.bungie.net' + itemDef.displayProperties.icon : '',
                    element: extraireElement(itemDef, instMarchand[sKey] || null),
                    categorie: itemDef.itemType === 3 ? 'weapon' : (itemDef.itemType === 2 ? 'armor' : 'other'),
                    tier: tierKey,
                    badgeTexte: nomMarchand,
                    stats: extraireStatsObjet(itemDef, sKey, statsMarchand),
                    perks: extrairePerksDetails(sKey, perksMarchand)
                };
                registreObjets[ukey] = obj;

                if (itemDef.itemType === 3) armes.push(obj);
                else if (itemDef.itemType === 2) armures.push(obj);
                else autres.push(obj);
                totalObjets++;
            }

            armes.sort((a, b) => a.typeNom.localeCompare(b.typeNom, 'fr') || a.nom.localeCompare(b.nom, 'fr'));
            if (armes.length + armures.length + autres.length > 0) {
                groupesMarchands[nomMarchand] = { nom: nomMarchand, icone: iconeMarchand, desc: descMarchand, armes, armures, autres };
            }
        }

        const noms = Object.keys(groupesMarchands).sort();
        document.getElementById('filtreMarchand').innerHTML =
            `<option value="all">Tous les Marchands (${noms.length})</option>` +
            noms.map(n => `<option value="${n}">${n}</option>`).join('');

        document.getElementById('count-vendors').textContent = noms.length;
        setStatus(`${noms.length} Marchands chargés (${totalObjets} offres).`);
        afficherVue();
    } catch (e) { setStatus("Erreur Marchands : " + e.message); }
}

function onDragStartItem(ev, itemHash, itemInstanceId, lieuType, bucketHash, charIdOwner) {
    fermerInspecteur(true);
    objetGlisse = {
        itemHash: Number(itemHash), itemInstanceId: String(itemInstanceId),
        lieuType, bucketHash: Number(bucketHash), charIdOwner: charIdOwner || ''
    };
    ev.dataTransfer.setData('text/plain', itemInstanceId);
}

function onDragOverZone(ev) { ev.preventDefault(); ev.currentTarget.classList.add('drag-over'); }
function onDragLeaveZone(ev) { ev.currentTarget.classList.remove('drag-over'); }

function onDropSurPerso(ev, targetCharId) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drag-over');
    if (!objetGlisse) return;
    transfererVersAutrePerso(objetGlisse.itemHash, objetGlisse.itemInstanceId, objetGlisse.lieuType, objetGlisse.charIdOwner, targetCharId);
    objetGlisse = null;
}

function onDropZone(ev, cibleMode, targetBucketHash) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drag-over');
    if (!objetGlisse) return;
    if (targetBucketHash && objetGlisse.bucketHash !== targetBucketHash) {
        setStatus("Action annulée : mauvais emplacement.");
        return;
    }
    if (objetGlisse.lieuType === cibleMode && (cibleMode === 'vault' || objetGlisse.charIdOwner === persoActifId)) return;
    executerMouvement(cibleMode, objetGlisse.itemHash, objetGlisse.itemInstanceId, objetGlisse.lieuType, objetGlisse.charIdOwner);
    objetGlisse = null;
}

// =========================================================================
// RENDU DES TUILES & VUES
// =========================================================================
function badgeTagTuile(item) {
    const t = obtenirTag(item);
    if (!t || !TAGS_CONFIG[t]) return '';
    const cfg = TAGS_CONFIG[t];
    return `<span class="tile-tag-badge" style="background:${cfg.bg}; border-color:${cfg.border};">${cfg.icon}</span>`;
}

function rendreBarrePuissanceTuile(item) {
    if (!item.power && !item.element) return '';
    const elemIcon = item.element
        ? (item.element.icone
            ? `<img class="tile-elem-icon" src="${item.element.icone}" alt="${item.element.court}">`
            : `<span class="elem-dot" style="background:${item.element.color};"></span>`)
        : '';
    return `<span class="tile-power">${elemIcon}${item.power || ''}</span>`;
}

function rendreCarteEquipee(item) {
    const statsPrincipales = (item.stats || []).slice(0, 6).map(s => `
        <div class="mini-stat">
            <span class="mini-stat-name" style="color:${s.isTotal ? 'var(--light)' : '#98a2ad'};">${s.nom}</span>
            ${s.isBar ? `<div class="mini-stat-bar-wrap"><div class="mini-stat-bar" style="width:${Math.min(100, s.val)}%;"></div></div>` : ''}
            <span class="mini-stat-val" style="color:${s.isTotal ? 'var(--light)' : '#f2f4f7'};">${s.val}</span>
        </div>
    `).join('');

    const perksChips = (item.perks || []).slice(0, 3).map(p => `
        <span class="eq-perk-chip">${p.icone ? `<img src="${p.icone}">` : ''}${p.nom}</span>
    `).join('');

    const nbExemplaires = compteDoublons[item.itemHash] || 1;
    const inCmp = comparateurKeys.includes(item.ukey) ? 'in-compare' : '';
    const isBusy = busyItems.has(item.itemInstanceId) ? 'tile-busy' : '';

    return `
        <div class="equipped-detail-card ${isBusy}"
             data-ukey="${item.ukey}"
             draggable="true"
             ondragstart="onDragStartItem(event, ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', ${item.bucketHash}, '${item.charIdOwner || ''}')"
             onmouseenter="afficherInspecteur(event, '${item.ukey}', false)"
             onmousemove="bougerInspecteur(event)"
             onmouseleave="fermerInspecteur(false)"
             onclick="afficherInspecteur(event, '${item.ukey}', true)">
            <div class="eq-top">
                <div class="gear-tile tier-${item.tier} ${inCmp}" style="width:48px; height:48px;">
                    <img src="${item.icone}" loading="lazy">
                    ${badgeTagTuile(item)}
                    ${nbExemplaires > 1 && filtreDoublonsActif ? `<span class="dupe-tag">×${nbExemplaires}</span>` : ''}
                    ${rendreBarrePuissanceTuile(item)}
                </div>
                <div class="eq-title">
                    <h4>${item.nom}</h4>
                    <span>${item.typeNom}${item.element ? ` • ${rendreElementInline(item, true)}` : ''}</span>
                </div>
            </div>
            ${statsPrincipales ? `<div class="eq-stats-grid">${statsPrincipales}</div>` : ''}
            ${perksChips ? `<div class="eq-perks">${perksChips}</div>` : ''}
        </div>
    `;
}

function rendreTuile(item) {
    const nbExemplaires = compteDoublons[item.itemHash] || 1;
    const inCmp = comparateurKeys.includes(item.ukey) ? 'in-compare' : '';
    const isBusy = busyItems.has(item.itemInstanceId) ? 'tile-busy' : '';
    return `
        <div class="gear-tile tier-${item.tier} ${inCmp} ${isBusy}"
             data-ukey="${item.ukey}"
             draggable="${item.lieuType !== 'postmaster'}"
             ondragstart="onDragStartItem(event, ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', ${item.bucketHash}, '${item.charIdOwner || ''}')"
             onmouseenter="afficherInspecteur(event, '${item.ukey}', false)"
             onmousemove="bougerInspecteur(event)"
             onmouseleave="fermerInspecteur(false)"
             onclick="afficherInspecteur(event, '${item.ukey}', true)"
             ondblclick="${item.lieuType === 'postmaster' ? `recupererDuPostmaster(${item.itemHash}, '${item.itemInstanceId}', ${item.stackSize})` : `executerMouvement('equipped', ${item.itemHash}, '${item.itemInstanceId}', '${item.lieuType}', '${item.charIdOwner || ''}')`}">
            <img src="${item.icone}" loading="lazy">
            ${badgeTagTuile(item)}
            ${nbExemplaires > 1 && filtreDoublonsActif ? `<span class="dupe-tag">×${nbExemplaires}</span>` : ''}
            ${rendreBarrePuissanceTuile(item)}
        </div>
    `;
}

function regrouperArmesParType(items, mode) {
    const groupes = {};
    items.forEach(item => {
        const cle = item.typeNom || 'Autre';
        if (!groupes[cle]) groupes[cle] = [];
        groupes[cle].push(item);
    });

    const typesTries = Object.keys(groupes).sort((a, b) => a.localeCompare(b, 'fr'));
    return typesTries.map(typeNom => {
        const arr = groupes[typeNom];
        if (filtreDoublonsActif) arr.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || (b.power || 0) - (a.power || 0));
        else arr.sort((a, b) => (b.power || 0) - (a.power || 0) || a.nom.localeCompare(b.nom, 'fr'));

        if (mode === 'bag') {
            return `<div class="bag-type-cluster"><span class="bag-type-label">${typeNom}</span><div class="bag-type-tiles">${arr.map(rendreTuile).join('')}</div></div>`;
        }
        return `<div class="vault-type-group"><div class="vault-type-label">${typeNom} <span>(${arr.length})</span></div><div style="display:flex; flex-wrap:wrap; gap:6px;">${arr.map(rendreTuile).join('')}</div></div>`;
    }).join('');
}

function rendreCarteJalon(m) {
    const phasesHtml = m.phases.length > 0 ? `
        <div class="phases-row" title="Rencontres validées cette semaine">
            ${m.phases.map(p => `<span class="phase-dot ${p.complete ? 'done' : ''}"></span>`).join('')}
            <small style="color:#98a2ad; font-size:0.7rem;">${m.phases.filter(p => p.complete).length} / ${m.phases.length} étapes</small>
        </div>
    ` : '';

    const objsHtml = m.objectifs.slice(0, 2).map(o => {
        const pct = o.complete ? 100 : Math.min(100, Math.round((o.progress / Math.max(1, o.max)) * 100));
        return `
            <div class="milestone-obj">
                <div style="display:flex; justify-content:space-between; gap:6px;"><span>${o.texte}</span><b>${o.progress} / ${o.max}</b></div>
                <div class="craft-prog-bar"><div class="craft-prog-fill ${o.complete ? 'done' : 'blue'}" style="width:${pct}%;"></div></div>
            </div>
        `;
    }).join('');

    const badgeRecompenseClass = m.estPrestige ? 'badge-pinnacle' : (m.estPuissant ? 'badge-powerful' : '');
    return `
        <div class="milestone-card ${m.possede ? 'completed' : (m.estPrestige ? 'pinnacle' : '')}">
            <img class="milestone-icon" src="${m.icone}" loading="lazy">
            <div class="item-info">
                <h4 title="${m.nom}">${m.nom}</h4>
                <p>${(m.sousTitre || "").substring(0, 95)}</p>
                <div>
                    <span class="badge ${m.possede ? 'badge-done' : ''}">${m.possede ? '✓ Complété' : 'À faire'}</span>
                    <span class="badge ${badgeRecompenseClass}">${m.recompense}</span>
                </div>
                ${phasesHtml}
                ${objsHtml}
            </div>
        </div>
    `;
}

function afficherVue() {
    afficherStatsGlobalesGardien();
    afficherBarreBuilds();
    afficherPostmaster();
    mettreAJourOptionsTags();

    const view = document.getElementById('mainView');
    if (ongletActif === 'optimizer') {
        view.innerHTML = rendreVueOptimiseur();
        return;
    }

    const filtreCat = document.getElementById('filtreCategorie').value;
    const filtreEtat = document.getElementById('filtreEtat').value;
    const filtreMarchand = document.getElementById('filtreMarchand').value;
    const filtreTag = document.getElementById('filtreTag').value;
    const recherche = document.getElementById('rechercheTexte').value.toLowerCase();

    const matchFiltres = (item) => {
        if (ongletActif === 'loadout') {
            if (filtreDoublonsActif && (compteDoublons[item.itemHash] || 0) <= 1) return false;
            if (filtreTag !== 'all') {
                const t = obtenirTag(item);
                if (filtreTag === 'untagged' && t !== null) return false;
                if (filtreTag !== 'untagged' && t !== filtreTag) return false;
            }
        }
        if (ongletActif !== 'milestones') {
            if (filtreCat === 'weapon' && item.categorie !== 'weapon') return false;
            if (filtreCat === 'armor' && item.categorie !== 'armor') return false;
            if (filtreCat === 'Exotic' && item.tier !== 'Exotic') return false;
        }
        if (recherche) {
            const mNom = item.nom.toLowerCase().includes(recherche);
            const mType = (item.typeNom || "").toLowerCase().includes(recherche);
            const mElem = (item.element?.nom || "").toLowerCase().includes(recherche) || (item.element?.court || "").toLowerCase().includes(recherche);
            const mPerk = item.perks && item.perks.some(p => p.nom.toLowerCase().includes(recherche));
            const mSource = (item.source || item.sousTitre || item.recompense || "").toLowerCase().includes(recherche);
            if (!mNom && !mType && !mElem && !mPerk && !mSource) return false;
        }
        return true;
    };

    if (ongletActif === 'loadout') {
        const p = mapPersos[persoActifId];
        if (!p) { view.innerHTML = `<p style="color:#64748b;">Clique sur "Se connecter avec Bungie.net" en haut à droite.</p>`; return; }

        const lignesSlotsHtml = SLOTS_DESTINY.filter(s => !(filtreCat === 'weapon' && s.type !== 'weapon') && !(filtreCat === 'armor' && s.type !== 'armor')).map(slot => {
            const eqItem = p.equipped.find(i => i.bucketHash === slot.hash && matchFiltres(i));
            const bagItems = p.inventory.filter(i => i.bucketHash === slot.hash && matchFiltres(i));
            const bagContentHtml = bagItems.length === 0
                ? '<small style="color:#475569; font-size:0.74rem;">Vide</small>'
                : (slot.type === 'weapon' ? regrouperArmesParType(bagItems, 'bag') : bagItems.map(rendreTuile).join(''));

            return `
                <div class="slot-row">
                    <div class="slot-label">${slot.nom}</div>
                    <div class="drop-zone equipped-zone" ondragover="onDragOverZone(event)" ondragleave="onDragLeaveZone(event)" ondrop="onDropZone(event, 'equipped', ${slot.hash})">
                        ${eqItem ? rendreCarteEquipee(eqItem) : '<small style="color:#475569; font-size:0.74rem;">—</small>'}
                    </div>
                    <div class="drop-zone" ondragover="onDragOverZone(event)" ondragleave="onDragLeaveZone(event)" ondrop="onDropZone(event, 'inventory', ${slot.hash})">
                        ${bagContentHtml}
                    </div>
                </div>
            `;
        }).join('');

        const coffreGroupesHtml = SLOTS_DESTINY.filter(s => !(filtreCat === 'weapon' && s.type !== 'weapon') && !(filtreCat === 'armor' && s.type !== 'armor')).map(slot => {
            const itemsSlot = listeCoffre.filter(i => i.bucketHash === slot.hash && matchFiltres(i));
            if (itemsSlot.length === 0) return '';
            if (slot.type === 'weapon') return `<div class="vault-slot-group"><h5>${slot.nom} (${itemsSlot.length})</h5>${regrouperArmesParType(itemsSlot, 'vault')}</div>`;
            if (filtreDoublonsActif) itemsSlot.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
            return `<div class="vault-slot-group"><h5>${slot.nom} (${itemsSlot.length})</h5><div style="display:flex; flex-wrap:wrap; gap:6px;">${itemsSlot.map(rendreTuile).join('')}</div></div>`;
        }).join('');

        view.innerHTML = `
            <div class="loadout-workspace">
                <div class="slots-column">
                    <div style="display:grid; grid-template-columns:120px 310px 1fr; gap:12px; padding:0 10px 8px 10px; font-size:0.74rem; font-weight:700; text-transform:uppercase;">
                        <span>Emplacement</span><span>Équipé</span><span>Sac — ${p.classeNom}</span>
                    </div>
                    ${lignesSlotsHtml}
                </div>
                <div class="vault-column" ondragover="onDragOverZone(event)" ondragleave="onDragLeaveZone(event)" ondrop="onDropZone(event, 'vault', null)">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <h3 style="margin:0;">🏦 Coffre (${listeCoffre.length} / 700)</h3>
                    </div>
                    ${coffreGroupesHtml || '<p style="color:#64748b; font-size:0.85rem;">Aucun objet pour ce filtre.</p>'}
                </div>
            </div>
        `;
        return;
    }

    if (ongletActif === 'milestones') {
        const p = mapPersos[persoActifId];
        if (!p) { view.innerHTML = `<p style="color:#64748b;">Connecte-toi pour voir tes jalons hebdomadaires.</p>`; return; }
        const liste = (p.milestones || []).filter(m => !(filtreEtat === 'missing' && m.possede) && !(filtreEtat === 'owned' && !m.possede) && matchFiltres(m));
        const nbRestants = (p.milestones || []).filter(m => !m.possede).length;
        const nbTotal = (p.milestones || []).length;
        const blocSection = (titre, arr) => arr.length === 0 ? '' : `<div class="milestone-group-title"><span>${titre}</span><small style="color:#98a2ad;">${arr.filter(x => !x.possede).length} à faire / ${arr.length}</small></div><div class="grid">${arr.map(rendreCarteJalon).join('')}</div>`;

        view.innerHTML = `
            <div class="reset-banner">
                <div>
                    <h3 style="margin:0; font-size:1.05rem; color:var(--text);">📅 Activités de la semaine — ${p.classeNom} (✦ ${p.light})</h3>
                    <small style="color:#98a2ad;">${nbRestants} jalons restants sur ${nbTotal} avant le reset du mardi</small>
                </div>
                <div class="reset-timer">⏳ Reset dans ${calculerCompteAReboursReset()}</div>
            </div>
            ${blocSection('☠️ Raids & Donjons', liste.filter(m => m.groupe === 'raid_dungeon'))}
            ${blocSection('🛡️ Nuit Noire, Avant-Garde, Épreuve & Gambit', liste.filter(m => m.groupe === 'ritual'))}
            ${blocSection('⭐ Missions Exotiques & Autres Défis Hebdomadaires', liste.filter(m => m.groupe === 'weekly'))}
            ${liste.length === 0 ? '<p style="color:#64748b;">Aucun jalon pour ce filtre.</p>' : ''}
        `;
        return;
    }

    if (ongletActif === 'vendors') {
        const vendeurs = Object.values(groupesMarchands).filter(v => filtreMarchand === 'all' || v.nom === filtreMarchand);
        if (vendeurs.length === 0) { view.innerHTML = `<p style="color:#64748b;">Aucun marchand chargé.</p>`; return; }

        const rendreCarteMarchand = (item) => `
            <div class="item-card tier-${item.tier}" data-ukey="${item.ukey}"
                 onmouseenter="afficherInspecteur(event, '${item.ukey}', false)" onmousemove="bougerInspecteur(event)"
                 onmouseleave="fermerInspecteur(false)" onclick="afficherInspecteur(event, '${item.ukey}', true)">
                <img class="item-icon" src="${item.icone}" loading="lazy">
                <div class="item-info">
                    <h4>${rendreElementInline(item, false)} ${item.nom}</h4>
                    <p>${item.source}</p>
                    <span class="badge">${item.badgeTexte}</span>
                </div>
            </div>
        `;

        view.innerHTML = vendeurs.map(v => {
            const armes = v.armes.filter(matchFiltres), armures = v.armures.filter(matchFiltres), autres = v.autres.filter(matchFiltres);
            if (armes.length + armures.length + autres.length === 0) return '';
            return `
                <div class="vendor-section">
                    <div class="vendor-header">
                        ${v.icone ? `<img class="vendor-icon" src="${v.icone}">` : ''}
                        <div><h3 style="margin:0;">${v.nom}</h3>${v.desc ? `<small style="color:#98a2ad;">${v.desc}</small>` : ''}</div>
                    </div>
                    ${armes.length ? `<div class="vendor-cat-title">🔫 Armes (${armes.length})</div><div class="grid">${armes.map(rendreCarteMarchand).join('')}</div>` : ''}
                    ${armures.length ? `<div class="vendor-cat-title">🛡️ Armures (${armures.length})</div><div class="grid">${armures.map(rendreCarteMarchand).join('')}</div>` : ''}
                    ${autres.length && filtreCat === 'all' ? `<div class="vendor-cat-title">📜 Contrats & Offres (${autres.length})</div><div class="grid">${autres.slice(0, 12).map(rendreCarteMarchand).join('')}</div>` : ''}
                </div>
            `;
        }).join('');
        return;
    }

    if (ongletActif === 'crafting') {
        const models = listeCrafting.filter(item => !(filtreEtat === 'missing' && item.possede) && !(filtreEtat === 'owned' && !item.possede) && matchFiltres(item));
        view.innerHTML = `<div class="grid">` + models.map(item => {
            const pct = Math.min(100, Math.round((item.progActuel / item.progMax) * 100));
            return `
                <div class="item-card ${item.possede ? 'tier-' + item.tier : 'deepsight-active'}" data-ukey="${item.ukey}"
                     onmouseenter="afficherInspecteur(event, '${item.ukey}', false)" onmousemove="bougerInspecteur(event)"
                     onmouseleave="fermerInspecteur(false)" onclick="afficherInspecteur(event, '${item.ukey}', true)">
                    <img class="item-icon ${item.possede ? '' : 'red-border'}" src="${item.icone}" loading="lazy">
                    <div class="item-info">
                        <h4>${rendreElementInline(item, false)} ${item.nom}</h4>
                        <p>${item.source}</p>
                        <div class="craft-prog-bar"><div class="craft-prog-fill ${item.possede ? 'done' : ''}" style="width:${pct}%;"></div></div>
                        <span class="badge ${item.possede ? 'craft-ok' : 'craft-pending'}">${item.badgeTexte}</span>
                    </div>
                </div>
            `;
        }).join('') + `</div>`;
        return;
    }

    if (ongletActif === 'catalysts') {
        const cats = listeCatalyseurs.filter(item => !(filtreEtat === 'missing' && item.possede) && !(filtreEtat === 'owned' && !item.possede) && matchFiltres(item));
        view.innerHTML = `<div class="grid">` + cats.map(item => {
            const pct = item.possede ? 100 : Math.min(100, Math.round((item.progActuel / Math.max(1, item.progMax)) * 100));
            const cardClass = item.possede ? 'tier-Exotic' : (item.enCours ? 'catalyst-progress' : 'missing');
            const badgeClass = item.possede ? 'craft-ok' : (item.enCours ? 'cat-progress' : 'cat-missing');
            return `
                <div class="item-card ${cardClass}" data-ukey="${item.ukey}"
                     onmouseenter="afficherInspecteur(event, '${item.ukey}', false)" onmousemove="bougerInspecteur(event)"
                     onmouseleave="fermerInspecteur(false)" onclick="afficherInspecteur(event, '${item.ukey}', true)">
                    <img class="item-icon" src="${item.icone}" loading="lazy">
                    <div class="item-info">
                        <h4>${item.nom}</h4><p>${item.source.substring(0, 90)}</p>
                        ${item.progMax > 1 ? `<div class="craft-prog-bar"><div class="craft-prog-fill ${item.possede ? 'done' : 'blue'}" style="width:${pct}%;"></div></div>` : ''}
                        <span class="badge ${badgeClass}">${item.badgeTexte}</span>
                    </div>
                </div>
            `;
        }).join('') + `</div>`;
        return;
    }

    const source = { quests: listeQuetes, exotics: listeExotiques, triumphs: listeTriomphes }[ongletActif] || [];
    const resultats = source.filter(item => !(filtreEtat === 'missing' && item.possede) && !(filtreEtat === 'owned' && !item.possede) && matchFiltres(item)).slice(0, 160);

    view.innerHTML = `<div class="grid">` + resultats.map(item => `
        <div class="item-card ${item.possede === false && ongletActif !== 'quests' ? 'missing' : 'tier-' + item.tier}"
             ${item.ukey ? `data-ukey="${item.ukey}" onmouseenter="afficherInspecteur(event, '${item.ukey}', false)" onmousemove="bougerInspecteur(event)" onmouseleave="fermerInspecteur(false)" onclick="afficherInspecteur(event, '${item.ukey}', true)"` : ''}>
            <img class="item-icon" src="${item.icone}" loading="lazy">
            <div class="item-info">
                <h4>${rendreElementInline(item, false)} ${item.nom}</h4>
                <p>${item.source.substring(0, 85)}</p>
                <span class="badge">${item.badgeTexte}</span>
            </div>
        </div>
    `).join('') + `</div>`;
}
