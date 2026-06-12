/*

Web interface events and listeners

*/
const downloadZipButton = document.getElementById("downloadZip")
const hatsOutput = document.getElementById("hats-output")
setVisibleAfterLoad(false);
function setVisibleAfterLoad(visible) {
	const visibleAfterLoad = document.querySelectorAll(".visibleAfterLoad")
	visibleAfterLoad.forEach(el => el.hidden = !visible);
}

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
			setVisibleAfterLoad(true);
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
		if (hats.length == 1) {
			setVisibleAfterLoad(true);
		}
		createOutputElem(hat.name, hat.hatFileName, hat.newFileName, hat.blob);
		console.log(`Processed file: ${hat.hatFileName} -> ${hat.newFileName}.png`);
	}
	return hat;
}

const inputElement = document.getElementById("upload");
inputElement.addEventListener("change", () => handleFiles(inputElement.files), false);
const clearHatsButton = document.getElementById("clear-hats");
clearHatsButton.addEventListener("click", clearHatList);
function clearHatList() {
	// hats = []; // It's a const, prevent reassignment.
	hats.splice(0, hats.length);
	hatsOutput.innerHTML = "";
	downloadZipButton.hidden = true;
	setVisibleAfterLoad(false);
	console.log("Cleared all hats.");
}

function toggleDarkMode() {
	const darkModeClass = "dark-mode";
	document.body.classList.toggle(darkModeClass);
	console.log("Toggled dark mode.");
}
const toggleDarkModeButton = document.getElementById("toggle-dark-mode")
toggleDarkModeButton.addEventListener("click", toggleDarkMode);

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

const customAttributeTemplateIndex = "template-index"
function getImageTemplate(hatWidth){
	if (hatWidth < 32) {
		console.log("Hat width is smaller than 32px, hiding duck template overlay.");
		return 0 // no image or fallback to "./media/Template-1x.png"
	}
	if (hatWidth === 32) {
		return 1
	}
	else if (hatWidth === 64) {
		return 2
	}
	else if (hatWidth > 64 && hatWidth < 96) {
		console.log("Hat width has a semi-cape, missing pixels from cape.");
		return 3
	}
	else if (hatWidth === 96) {
		return 3
	}
	else if (hatWidth === 97) {
		return 4
	}
	else if (hatWidth > 97) {
		console.log("Hat width is greater than 97px, using largest template available.");
		return 4
	}
	return null;
}

const duckColors = {
	 white: { light: "#FFFFFF", dark: "#9d9d9d",
		 t1: "./media/Template-1x.png"
		,t2: "./media/Template-2x.png"
		,t3: "./media/Template-3x.png"
		,t4: "./media/Template-4x.png"
		,w1: "./media/Template-1x-wing.png"
		,w2: "./media/Template-2x-wing.png"
		,w3: "./media/Template-3x-wing.png"
		,w4: "./media/Template-4x-wing.png"
	 }
	,gray: { light: "#807c73", dark: "#5b5652"}
	,yellow: {light: "#ffdc58", dark: "#ba993c"}
	,brown: {light: "#d76816", dark: "#95490d"}
	,pink: {light: "#ff6975", dark: "#d0545f"}
	,purple: {light: "#ac56dd", dark: "#8a26be"}
	,blue: {light: "#2fa2f2", dark: "#0a7cba"}
	,green: {light: "#00874b", dark: "#006637"}
}
let currentColorIndex = 0;
const toggleOverlayColorsButton = document.getElementById("toggle-overlay-colors");
toggleOverlayColorsButton.addEventListener("click", toggleDuckOverlayColors);
function toggleDuckOverlayColors(){
	currentColorIndex++;
	if (currentColorIndex >= 8) {
		currentColorIndex = 0;
	}
	var newColorName = Object.keys(duckColors)[currentColorIndex];
	setDuckOverlayColorByName(newColorName);
}
function setDuckOverlayColorByIndex(currentColorIndex){
	var newColorName = Object.keys(duckColors)[currentColorIndex];
	setDuckOverlayColorByName(newColorName);
}
function setDuckOverlayColorByName(newColorName){
	var newColors = duckColors[newColorName];
	console.log(`Changing duck color overlay to ${newColorName}.`);
	setDuckOverlayColor(newColors);
}
function setDuckOverlayColor(newDuckColor){
	if (newDuckColor == null) {
		return;
	}
	var imgWingList = document.querySelectorAll(".hat-image-overlay-wing");
	for (var imgWing of imgWingList) {
		var templateIndex = imgWing.getAttribute(customAttributeTemplateIndex);
		if (templateIndex === "null") {
			continue;
		}
		imgWing.src = newDuckColor["w" + templateIndex];
		if (imgWing.src == null) {
			console.log("NULL overlay image wing detected!");
		}
	}
	var imgBodyList = document.querySelectorAll(".hat-image-overlay-body");
	for (var imgBody of imgBodyList) {
		var templateIndex = imgBody.getAttribute(customAttributeTemplateIndex);
		if (templateIndex === "null") {
			continue;
		}
		imgBody.src = newDuckColor["t" + templateIndex];
		if (imgBody.src == null) {
			console.log("NULL overlay image body detected!");
		}
	}
}
preloadDuckOverlayColors();
async function preloadDuckOverlayColors(newDuckColor){
	var colorNames = Object.keys(duckColors);
	for (var colorName of colorNames) {
		var newDuckColor = duckColors[colorName];
		await preloadDuckColorsFromWhite(newDuckColor);
		console.log(`Preloaded overlay colors ${colorName}`, newDuckColor);
	}
}

async function preloadDuckColorsFromWhite(newDuckColor){
	if (newDuckColor.t1 != null) {
		return; // already loaded.
	}
	newDuckColor.t1 = await replaceDuckColorsFromWhite(duckColors.white.t1, newDuckColor);
	newDuckColor.t2 = await replaceDuckColorsFromWhite(duckColors.white.t2, newDuckColor);
	newDuckColor.t3 = await replaceDuckColorsFromWhite(duckColors.white.t3, newDuckColor);
	newDuckColor.t4 = await replaceDuckColorsFromWhite(duckColors.white.t4, newDuckColor);
	newDuckColor.w1 = await replaceDuckColorsFromWhite(duckColors.white.w1, newDuckColor);
	newDuckColor.w2 = await replaceDuckColorsFromWhite(duckColors.white.w2, newDuckColor);
	newDuckColor.w3 = await replaceDuckColorsFromWhite(duckColors.white.w3, newDuckColor);
	newDuckColor.w4 = await replaceDuckColorsFromWhite(duckColors.white.w4, newDuckColor);
}

async function replaceHatTransparentPink(imgSrc){
	return await tryReplaceColors(imgSrc, [
		{ oldColor: "#ff00ff", newColor: "#ff00ff00" }
	]);
}
async function replaceDuckColorsFromWhite(imgSrc, newDuckColor){
	return await tryReplaceColors(imgSrc, [
		{ oldColor: "#FFFFFF", newColor: newDuckColor.light },
		{ oldColor: "#9d9d9d", newColor: newDuckColor.dark }
	]);
}
async function tryReplaceColors(imgSrc, replacements){
	try {
		return await replaceColors(imgSrc, replacements);
	} catch(e) {
		console.error(`Error replacing image color for: ${imgSrc}`, e);
		return null;
	}
}
function hexToRgb(hex) {
	hex = hex.replace("#", "");
	if (hex.length === 3) {
		hex = hex.split("").map(x => x + x).join("");
	}
	return {
		 r: parseInt(hex.substring(0, 2), 16)
		,g: parseInt(hex.substring(2, 4), 16)
		,b: parseInt(hex.substring(4, 6), 16)
		,a: parseInt(hex.substring(6, 8), 16)
	};
}
async function replaceColors(src, replacements) {
	const lookup = new Map();
	for (const pair of replacements) {
		const oldRgb = hexToRgb(pair.oldColor);
		const newRgb = hexToRgb(pair.newColor);

		const key =
			(oldRgb.r << 16) |
			(oldRgb.g << 8) |
				oldRgb.b;

		lookup.set(key, newRgb);
	}
	const img = new Image();
	img.crossOrigin = "anonymous";
	await new Promise((resolve, reject) => {
		img.onload = resolve;
		img.onerror = reject;
		img.src = src;
	});

	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;

	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;
	for (let i = 0; i < data.length; i += 4) {
		const key =
			(data[i] << 16) |
			(data[i + 1] << 8) |
				data[i + 2];

		const replacement = lookup.get(key);
		if (replacement) {
			data[i] = replacement.r;
			data[i + 1] = replacement.g;
			data[i + 2] = replacement.b;
			const hasTransparencyData = !isNaN(replacement.a);
			if (hasTransparencyData) {
			data[i + 3] = replacement.a;
			}
		}
	}
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL("image/png");
}

loadColorOptionDropdown();
function loadColorOptionDropdown(){
	const menu = document.querySelector(".menu");
	const template = document.getElementById("color-template");

	const colorNames = Object.entries(duckColors);
	colorNames.forEach(([name, color]) => {
		const clone = template.content.cloneNode(true);
		const btn = clone.querySelector("button");
		const btnText = btn.querySelector("div");

		btnText.textContent = name;
		btn.style.background = color.light;
		btn.dataset.color = color.light;

		btn.addEventListener("click", () => {
			setDuckOverlayColorByName(name);
		});

		menu.appendChild(clone);
	});
}

const toggleOverlaysButton = document.getElementById("toggle-overlays");
toggleOverlaysButton.addEventListener("click", toggleDuckOverlayVisibility);
function toggleDuckOverlayVisibility(){
	const duckTemplateElements = document.querySelectorAll(".hat-image-overlay");
	const wasHidden = duckTemplateElements[0]?.parentElement?.hidden ?? false;
	const isHiddenNow = !wasHidden;
	duckTemplateElements.forEach(el => {
		el.parentElement.hidden = isHiddenNow;
	});
	// console.log(`Toggling duck template overlay visibility ${isHiddenNow}.`);
	setVisibilityIcon(!isHiddenNow);
}
let visibilityIcons = "🤓🫣";
/*
Other possible icons:
visibilityIcons = "🤓🫣";
visibilityIcons = "🧐😵";
visibilityIcons = "😗😙";
visibilityIcons = "😶😌";
visibilityIcons = "👁️👁️";
visibilityIcons = "🙉🙈";
visibilityIcons = "🕶👓";
visibilityIcons = "◉◎";
*/

function setVisibilityIcon(visible = true) {

	const emojis = [...visibilityIcons];
	const emoji1 = emojis[0];
	const emoji2 = emojis[1];
	toggleOverlaysButton.innerText = visible? emoji1 : emoji2;
}
setVisibilityIcon();
const hatTemplate = document.getElementById("hat-template");
function createOutputElem(name, hatFileName, newFileName, blob){
	const hatContainer = hatTemplate.content.cloneNode(true);
	const img = hatContainer.querySelector("img.hat-image");
	const a = hatContainer.querySelector("a");;
	const title = hatContainer.querySelector(".title");
	const imgOverlay = hatContainer.querySelector(".hat-image-overlay");
	const imgOverlayWing = hatContainer.querySelector(".hat-image-overlay-wing");

	const nameDesc = getNameDescription(name, hatFileName, newFileName)
	title.innerText = nameDesc
	title.title = `Original file name: ${hatFileName}\nHat metadata name: ${name}\nOutput file name: ${newFileName}.png`

	img.src = URL.createObjectURL(blob)
	// img.src = await replaceHatTransparentPink(img.src);
	replaceHatTransparentPink(img.src).then(r => img.src = r);
	img.alt = `Image for ${hatFileName}`
	// img.title = `Download ${newFileName}.png`

	img.onload = () => {
		const templateIndex = getImageTemplate(img.naturalWidth)
		imgOverlay.setAttribute(customAttributeTemplateIndex, templateIndex);
		imgOverlayWing.setAttribute(customAttributeTemplateIndex, templateIndex);
		if (templateIndex > 0) {
			imgOverlay.src = `./media/Template-${templateIndex}x.png`
			imgOverlayWing.src = `./media/Template-${templateIndex}x-wing.png`
			if (img.naturalWidth > 97) {
				imgOverlay.classList.add("hat-image-is-bigger");
				imgOverlayWing.classList.add("hat-image-is-bigger");
			}
		}
	};

	a.href = img.src
	a.download = `${newFileName}.png`
	hatsOutput.appendChild(hatContainer)
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


document.addEventListener("keydown", (e) => {
	const colorNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
	const selectColorByNumber = colorNumbers.some(c => c == e.key);
	if (selectColorByNumber) {
		const newColorIndex = e.key -1;
		setDuckOverlayColorByIndex(newColorIndex);
	}
	if (e.shiftKey && e.key.toUpperCase() == "C") {
		toggleDuckOverlayColors();
	}
	if (e.shiftKey && e.key.toUpperCase() == "D") {
		toggleDarkMode();
	}
	if (e.shiftKey && e.key.toUpperCase() == "V") {
		toggleDuckOverlayVisibility();
	}
});
