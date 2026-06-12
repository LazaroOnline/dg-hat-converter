/*

Web interface events and listeners

*/
const downloadZipButton = document.getElementById("downloadZip")
const visibleAfterLoad = document.querySelectorAll(".visibleAfterLoad")
const hatsOutput = document.getElementById("hats-output")

// handle file "uploads"
async function handleFiles(files) {
	try {
		downloadZipButton.hidden = true;
		await loadHatFileList(files);
	}
	catch(e) {
		console.error("Error processing files:", e);
		alert("An error occurred while processing the files. Please check the console for details.");
	}
	finally {
		if (hats.length > 0) {
			downloadZipButton.hidden = false;
			visibleAfterLoad.forEach(el => el.hidden = false);
		}
		inputElement.value = ''; // Clear the file input for better UX, allowing the same files to be selected again if needed.
	}
}

async function loadHatFileList(files) {
	if (files.length === 0) {
		console.log("No files to process.");
		return;
	}
	const BATCH_SIZE = 100;
	const promises = await batchProcessArray(files, loadHatFile, BATCH_SIZE);
	const hatPromises = await Promise.all(promises);
	const hatResults = hatPromises.filter(h => h.status === "fulfilled").map(h => h.value);
	const filesSkipped = hatResults.filter(h => h.blob == null);
	const hatListAll = hatResults.filter(h => h.blob != null);
	const errors = hatPromises.filter(h => h.status === "rejected").map(h => h.reason);
	const newHats = hatListAll.filter(h => h?.duplicateOf == null);
	const hatDupeList = hatListAll.filter(h => h?.duplicateOf != null);
	const newHatsRenamed = newHats.filter(h => h?.isRenamedToBeUnique);
	console.log(`Finished processing all ${files.length} files, added ${newHats.length} new hats.\n`, newHats);
	if (hatDupeList.length > 0) {
		console.warn(`Found ${hatDupeList.length} duplicate hats that were skipped:\n`, hatDupeList);
	}
	if (newHatsRenamed.length > 0) {
		console.warn(`Found ${newHatsRenamed.length} new hats that were renamed to be unique:\n`, newHatsRenamed);
	}
	if (filesSkipped.length > 0) {
		console.warn(`Found ${filesSkipped.length} files that were not hat files:\n`, filesSkipped);
	}
	if (errors.length > 0) {
		console.error(`Found ${errors.length} errors while processing hats:`, errors);
		alert(`Finished processing files with ${errors.length} errors. Please check the console for details.`);
	}
	if (newHats.length !== hats.length) {
		console.log(`Total hats accumulated: ${hats.length}\n`, hats);
	}
	await tryCreateZip(hats);
}

async function batchProcessArray(list, processFunc, batchSize = 100) {
	const array = Array.from(list);
	console.log(`Started processing ${array.length} elements in total.`);
	const totalBatches = Math.ceil(array.length / batchSize);
	const promises = [];
	for (let start = 0; start < array.length; start += batchSize) {
		const batch = array.slice(start, start + batchSize);
		if (list.length > batchSize) {
			console.log(`Started processing batch ${Math.floor(start / batchSize) + 1} of ${totalBatches}: ${batch.length} elements...`);
		}
		const batchPromises = batch.map(element => processFunc(element));
		const results = await Promise.allSettled(batchPromises);
		promises.push(...results);
	}
	// console.log(`Finished processing all ${array.length} elements.`);
	return promises;
}

function hasHatFileExtension(fileName) {
	return fileName.toLowerCase().endsWith(".hat");
}

async function loadHatFile(file) {
	const fileBytesBuffer = await file.arrayBuffer();
	let decryptedHat = null;
	try {
		decryptedHat = await decryptHat(fileBytesBuffer);
	}
	catch (e) {
		const hasHatExtension = hasHatFileExtension(file.name);
		if (!hasHatExtension) {
			console.warn(`File "${file.name}" is not a 'hat' file and does not have the '.hat' extension. Skipping...`);
			return { hatFileName: file.name, message: "Not a .hat file" };
		}
		const errorMessage = `Error processing file ${file.name} - it may not be a valid .hat file or may be corrupted.`;
		console.error(errorMessage, e);
		throw new Error(`${errorMessage}: ${e.message}`, { cause: e });
	}
	const nameSanitized = sanitizeFileName(decryptedHat.name);
	const nameSanitizedUnique = makeUniqueFileName(nameSanitized, hats.map(h => h.newFileName));
	const isRenamedToBeUnique = nameSanitizedUnique !== nameSanitized;
	// "name" is the metadata inside the hat file.
	// "hatFileName" is the original .hat file name.
	// "newFileName" is the sanitized and made-unique name for the output PNG.
	const hat = {
		hatFileName: file.name,
		name: decryptedHat.name,
		newFileName: nameSanitizedUnique,
		isRenamedToBeUnique: isRenamedToBeUnique,
		blob: decryptedHat.blob
	}
	const alreadyExistingHat = existHat(hat, hats);
	if (alreadyExistingHat) {
		hat.duplicateOf = alreadyExistingHat;
		console.warn(`Hat "${hat.name}" with ${hat.blob.size} bytes already exists. Skipping duplicate: ${hat.hatFileName} (already added from: "${alreadyExistingHat.hatFileName}")`);
	}
	else {
		hats.push(hat);
		createOutputElem(hat.name, hat.hatFileName, hat.newFileName, hat.blob);
		console.log(`Processed file: ${hat.hatFileName} -> ${hat.newFileName}.png`);
	}
	return hat;
}

const inputElement = document.getElementById("upload");
inputElement.addEventListener("change", () => handleFiles(inputElement.files), false);
const clearHatsButton = document.getElementById("clear-hats")
clearHatsButton.addEventListener("click", () => {
	// hats = []; // It's a const, prevent reassigment.
	hats.splice(0, hats.length);
	hatsOutput.innerHTML = "";
	downloadZipButton.hidden = true;
	visibleAfterLoad.forEach(el => el.hidden = true);
	console.log("Cleared all hats.");
});

function toggleDarkMode() {
	const darkModeClass = "dark-mode";
	document.body.classList.toggle(darkModeClass);
	console.log("Toggled dark mode.");
}
const toggleDarkModeButton = document.getElementById("toggle-dark-mode")
toggleDarkModeButton.addEventListener("click", () => {
	toggleDarkMode();
});

const darkModeMql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
if (darkModeMql && darkModeMql.matches) {
	toggleDarkMode();
}

let dropArea = document.getElementById("dropArea");
let dropbox = document.getElementById("uploadbox");
function dragenter(e) {
	dropbox.classList.add("drop");
	e.stopPropagation();
	e.preventDefault();
}
function dragover(e) {
	dropbox.classList.add("drop");
	e.stopPropagation();
	e.preventDefault();
}
function dragend(e) {
	dropbox.classList.remove("drop");
}
function drop(e) {
	dropbox.classList.remove("drop");
	e.stopPropagation();
	e.preventDefault();
	const dt = e.dataTransfer;
	const files = dt.files;
	handleFiles(files);
}
dropArea.addEventListener("dragenter", dragenter, false);
dropArea.addEventListener("dragover", dragover, false);
dropArea.addEventListener("drop", drop, false);
dropArea.addEventListener("dragleave", dragend, false);
dropArea.addEventListener("dragend", dragend, false);

/*

Hat decoder

*/
const hats = []
let unnamedCounter = 0

// https://github.com/penguinscode/Quackhead/blob/2681ee7b71a57ab235742a24399babfe323b3ac5/quackhead.js#L14
const keyb64 = "8xaYIAH0em9hKg0CEw8t5g==";
const keyBytes = Uint8Array.from(atob(keyb64), c => c.charCodeAt(0));
let encryptionKey = null;

async function getEncryptionKey(){
	if (encryptionKey != null) {
		return encryptionKey;
	}
	encryptionKey = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "AES-CBC" },
		false,
		["decrypt"]
	);
	return encryptionKey;
}

async function decryptHat(hatFileArrayBuffer){
	const encryptionKey = await getEncryptionKey();
	const ivLength = new DataView(hatFileArrayBuffer.slice(0, 4)).getUint8();
	const iv = hatFileArrayBuffer.slice(4, 4+ivLength);
	const decryptedHatArrayBuffer = await window.crypto.subtle.decrypt(
		{
			name: "AES-CBC",
			iv: iv
		},
		encryptionKey,
		hatFileArrayBuffer.slice(20)
	);
	return parseMetadata(decryptedHatArrayBuffer);
}

function parseMetadata(decryptedHatArrayBuffer) {
	const hatNameLength = new DataView(decryptedHatArrayBuffer.slice(8, 9)).getUint8()
	const hatName = decryptedHatArrayBuffer.slice(9, 9+hatNameLength)
	let t = new TextDecoder()
	let nameDecoded = t.decode(hatName)

	const blob = new Blob([decryptedHatArrayBuffer.slice(9+hatNameLength+4)], {
		type: "image/png"
	})

	const name = nameDecoded || `unnamed hat ${unnamedCounter}`
	if (!nameDecoded) {
		console.warn(`Hat name is empty. Using default name: ${name}`)
		unnamedCounter++
	}
	const sanitizedName = sanitizeHatMetadataName(name)
	const hatInfo = { name: sanitizedName, fileName: name, blob: blob }
	return hatInfo;
}

const invalidFileNameChars = '/\\:*?"<>|';

function makeUniqueFileName(name, existingNames) {
	let nameUnique = name
	let counter = 1
	while (existingNames.some(n => n.toLowerCase() === nameUnique.toLowerCase())) {
		nameUnique = name +"_" + counter
		counter++
	}
	if (nameUnique !== name) {
		// console.warn(`File name "${name}.png" is not unique. Using "${nameUnique}.png" instead.`)
	}
	return nameUnique
}

function sanitizeHatMetadataName(name) {
	let sanitized = name.trim();
	return sanitized;
}

function sanitizeFileName(name, replacement = '_') {
	let sanitized = name;
	for (const char of invalidFileNameChars) {
		sanitized = sanitized.replace(new RegExp("\\" + char, 'g'), replacement);
	}
	return sanitized;
}

function removeHatExtension(name) {
	return name.replace(/\.hat$/, "")
}

function existHat(hatInfo, hats) {
	return hats.find(h => compareHats(h, hatInfo));
}

function compareHats(hatInfo1, hatInfo2) {
	return hatInfo1.name === hatInfo2.name
		&& hatInfo1.blob.size === hatInfo2.blob.size;
}

function getNameDescription(name, hatFileName, newFileName) {
	let nameDesc = name;
	const hatFileNameNoExtension = removeHatExtension(hatFileName);
	if (name?.toLowerCase() !== hatFileNameNoExtension?.toLowerCase()) {
		nameDesc += ` (${hatFileName})`
	}
	if (name?.toLowerCase() !== newFileName?.toLowerCase()) {
		nameDesc += ` > ${newFileName}`
	}
	return nameDesc;
}

function createOutputElem(name, hatFileName, newFileName, blob){
	const cont = document.createElement("div")
	const img = document.createElement("img")
	const title = document.createElement("div")
	const a = document.createElement("a")
	// img.title = `Download ${newFileName}.png`

	cont.className = "duck-out"

	title.className = "title"
	const nameDesc = getNameDescription(name, hatFileName, newFileName)
	title.innerText = nameDesc
	title.title = `Original file name: ${hatFileName}\nHat metadata name: ${name}\nOutput file name: ${newFileName}.png`

	img.src = URL.createObjectURL(blob)
	img.alt = `Image for ${hatFileName}`

	a.href = img.src
	a.download = `${newFileName}.png`
	a.appendChild(img)

	cont.appendChild(title)
	cont.appendChild(a)
	hatsOutput.appendChild(cont)
}

async function tryCreateZip(hats){
	try {
		await createZip(hats);
	}
	catch(e) {
		console.error("Error creating ZIP file:", e);
		alert("An error occurred while creating the ZIP file. Please check the console for details.");
	}
}

async function createZip(hats){
	const zip = new JSZip();

	hats.forEach(hat => {
		let fn = hat.newFileName
		while (zip.file(`${fn}.png`)){
			fn = `${fn}_`
		}
		zip.file(`${fn}.png`, hat.blob)
	})

	const content = await zip.generateAsync({type:"blob"});
	downloadZipButton.href = URL.createObjectURL(content)
	downloadZipButton.download = "hats.zip"
};
