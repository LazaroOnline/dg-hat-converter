/*

Web interface events and listeners

*/
const downloadZipButton = document.getElementById("downloadZip")
const hatsOutput = document.getElementById("hats-output")
setVisibleAfterLoad(false);
function setVisibleAfterLoad(visible) {
	const visibleAfterLoad = document.querySelectorAll(".visibleAfterLoad")
	visibleAfterLoad.forEach(el => {
		el.hidden = !visible;
		el.style.display = visible? "" : "none";
	});
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
		if (hatsConverted.length > 0) {
			downloadZipButton.hidden = false;
		}
		if (hats.length > 0) {
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
	const hatPromises = await batchProcessArray(files, loadHatFilePngOrHat, BATCH_SIZE);
	// hatPromises.push({ status: 'rejected', reason: new Error('Test image error manually.') });
	
	const hatResults = hatPromises.filter(h => h.status === "fulfilled").map(h => h.value);
	const filesSkipped = hatResults.filter(h => h.blob == null || h.skipped);
	const hatListAll = hatResults.filter(h => h.blob != null && !h.skipped);
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
		console.log(`Total hats converted to PNG: ${hatsConverted.length}\n`, hatsConverted);
	}
	await tryCreateZip(hatsConverted);
}

async function batchProcessArray(list, processFuncAsync, batchSize = 100) {
	const array = Array.from(list);
	console.log(`Started processing ${array.length} elements in total.`);
	const totalBatches = Math.ceil(array.length / batchSize);
	const promises = [];
	for (let start = 0; start < array.length; start += batchSize) {
		const batch = array.slice(start, start + batchSize);
		if (list.length > batchSize) {
			console.log(`Started processing batch ${Math.floor(start / batchSize) + 1} of ${totalBatches}: ${batch.length} elements...`);
		}
		const batchPromises = batch.map(element => processFuncAsync(element));
		const results = await Promise.allSettled(batchPromises);
		promises.push(...results);
	}
	// console.log(`Finished processing all ${array.length} elements.`);
	return promises;
}

const hatExtensions = {
	 hat: ".hat"
	,png: ".png"
}
function hasHatFileExtension(fileName) {
	return hasFileExtension(fileName, ".hat");
}
function hasPngFileExtension(fileName) {
	return hasFileExtension(fileName, ".png");
}
function hasFileExtension(fileName, extension) {
	return fileName.toLowerCase().endsWith(extension);
}

async function loadHatFileFromHat(file) {
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
		const errorMessage = `Error processing file "${file.name}" - it may not be a valid .hat file or may be corrupted.`;
		console.error(errorMessage, e);
		throw new Error(`${errorMessage}: ${e.message}`, { cause: e });
	}
	const nameSanitized = sanitizeFileName(decryptedHat.name);
	const nameSanitizedUnique = makeUniqueFileName(nameSanitized, hatsConverted.map(h => h.newFileName));
	const isRenamedToBeUnique = nameSanitizedUnique !== nameSanitized;
	// "name" is the metadata inside the hat file.
	// "hatFileName" is the original .hat file name.
	// "newFileName" is the sanitized and made-unique name for the output PNG.
	const hat = {
		 hatFileName: file.name
		,name: decryptedHat.name
		,newFileName: nameSanitizedUnique
		,isRenamedToBeUnique: isRenamedToBeUnique
		,blob: decryptedHat.blob
	}
	const alreadyExistingHat = existHat(hat, hats);
	if (alreadyExistingHat) {
		hat.duplicateOf = alreadyExistingHat;
		console.warn(`Hat "${hat.name}" with ${hat.blob.size} bytes already exists. Skipping duplicate: ${hat.hatFileName} (already added from: "${alreadyExistingHat.hatFileName}")`);
	}
	else {
		await addHatFileInfo(hat);
	}
	return hat;
}

async function loadHatFilePngOrHat(file) {
	if (hasHatFileExtension(file.name)) {
		return await loadHatFileFromHat(file);
	} else if (hasPngFileExtension(file.name)){
		return await loadHatFileFromPng(file);
	} else {
		return { hatFileName: file.name, message: "Not a .png nor .hat file" };
	}
}

async function loadHatFileFromPng(file) {
	let hatInfoPng = null;
	try {
		hatInfoPng = await getHatInfoFromPng(file);
	}
	catch (e) {
		const hasPngExtension = hasPngFileExtension(file.name);
		if (!hasPngExtension) {
			console.warn(`File "${file.name}" is not a 'png' file and does not have the '.png' extension. Skipping...`);
			return { hatFileName: file.name, message: "Not a .png file" };
		}
		const errorMessage = `Error processing file "${file.name}" - it may not be a valid .png file or may be corrupted.`;
		console.error(errorMessage, e);
		throw new Error(`${errorMessage}: ${e.message}`, { cause: e });
	}

	// For hats that were already PNG this is not needed:
	// const nameSanitized = sanitizeFileName(hatInfoPng.name);
	// const nameSanitizedUnique = makeUniqueFileName(nameSanitized, hats.map(h => h.newFileName));
	// const isRenamedToBeUnique = nameSanitizedUnique !== nameSanitized;

	// "name" is the metadata inside the hat file.
	// "hatFileName" is the original .hat file name.
	// "newFileName" is the sanitized and made-unique name for the output PNG.
	const hat = {
		 hatFileName: file.name
		,name: hatInfoPng.name
		,newFileName: hatInfoPng.name //nameSanitizedUnique
		,isRenamedToBeUnique: false // isRenamedToBeUnique
		,blob: hatInfoPng.blob
	}
	const alreadyExistingHat = existHat(hat, hats);
	if (alreadyExistingHat) {
		hat.duplicateOf = alreadyExistingHat;
		console.warn(`Hat "${hat.name}" with ${hat.blob.size} bytes already exists. Skipping duplicate: ${hat.hatFileName} (already added from: "${alreadyExistingHat.hatFileName}")`);
	}
	else {
		await addHatFileInfo(hat);
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
const hatsConverted = []
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

async function getHatInfoFromPng(file){
	const blob = await getImageBlobFromFile(file);
	return { name: removeFileExtensionPng(file.name), blob: blob};
}

async function getImageBlobFromFile(file){
	const fileBytesBuffer = await file.arrayBuffer();
	return getImageBlobFromFileBuffer(fileBytesBuffer);
}

function getImageBlobFromFileBuffer(fileBytesBuffer){
	return new Blob([fileBytesBuffer], { type: "image/png"});
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

function removeFileExtensionHatOrPng(fileName) {
	let fileNameNoExtension = removeFileExtensionHat(fileName)
	fileNameNoExtension = removeFileExtensionPng(fileNameNoExtension)
	return fileNameNoExtension;
}
function removeFileExtensionHat(name) {
	return removeFileExtension(name, "hat")
}
function removeFileExtensionPng(name) {
	return removeFileExtension(name, "png")
}
function removeFileExtension(name, extWithoutDot) {
	const regex = new RegExp("\\." + extWithoutDot + "$", "i")
	return name.replace(regex, "");
}
function removeFileExtension(fileName) {
	return fileName.replace(/\.[^\.]*$/i, "");
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
	// const hatFileNameNoExtension = removeFileExtension(hatFileName);
	const hatFileNameNoExtension = removeFileExtensionHatOrPng(hatFileName);
	if (name?.toLowerCase() !== hatFileNameNoExtension?.toLowerCase()) {
		nameDesc += ` (${hatFileName})`
	}
	if (name?.toLowerCase() !== newFileName?.toLowerCase()) {
		nameDesc += ` > ${newFileName}`
	}
	return nameDesc;
}

const hatImageWidths = {
	 x1: 32 // Single hat
	,x2: 64 // Hat/Quack images
	,x3: 96 // Hat/Quack/Cape images
	,full: 97 // Hat/Quack/Cape/MetaPixels images (could be more, but not usual and not too much)
	,max: 120 // Any image wider than this won't be considered a hat.
}

const customAttributeTemplateIndex = "template-index"
function getImageTemplate(hatWidth){
	const w = hatImageWidths;
	if (hatWidth < w.x1) {
		console.log(`Hat width is smaller than ${w.x1}px, hiding duck template overlay.`);
		return 0 // no image or fallback to "./media/Template-1x.png"
	}
	if (hatWidth >= w.x1 && hatWidth < w.x2) {
		return 1
	}
	else if (hatWidth >= w.x2 && hatWidth < w.x3) {
		return 2
	}
	else if (hatWidth >= w.x3 && hatWidth < w.full) {
		return 3
	}
	else if (hatWidth >= w.full && hatWidth < w.max) {
		if (hatWidth > w.full) {
			console.log(`Hat width is greater than ${w.full}px, using largest template available.`);
		}
		return 4
	}
	else {
		// console.log(`Hat width is greater than ${w.max}, won't be considered a hat image, skipping.`);
		return 0
	}
	return null;
}

const duckColors = {
	 white: { light: "#FFFFFF", dark: "#9d9d9d", images: {
			t1: "./media/Template-1x.png"
			,t2: "./media/Template-2x.png"
			,t3: "./media/Template-3x.png"
			,t4: "./media/Template-4x.png"
			,w1: "./media/Template-1x-wing.png"
			,w2: "./media/Template-2x-wing.png"
			,w3: "./media/Template-3x-wing.png"
			,w4: "./media/Template-4x-wing.png"
		}
	 }
	,gray:   { light: "#807c73", dark: "#5b5652", images: { } }
	,yellow: { light: "#ffdc58", dark: "#ba993c", images: { } }
	,brown:  { light: "#d76816", dark: "#95490d", images: { } }
	,pink:   { light: "#ff6975", dark: "#d0545f", images: { } }
	,purple: { light: "#ac56dd", dark: "#8a26be", images: { } }
	,blue:   { light: "#2fa2f2", dark: "#0a7cba", images: { } }
	,green:  { light: "#00874b", dark: "#006637", images: { } }
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
	var newColor = duckColors[newColorName];
	console.log(`Changing duck color overlay to ${newColorName}.`);
	setDuckOverlayColor(newColor);
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
		imgWing.src = newDuckColor.images["w" + templateIndex];
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
		imgBody.src = newDuckColor.images["t" + templateIndex];
		if (imgBody.src == null) {
			console.log("NULL overlay image body detected!");
		}
	}
}
preloadDuckOverlayColors();
async function preloadDuckOverlayColors(newDuckColor) {
	var colorNames = Object.keys(duckColors);
	var promises = [];
	for (var colorName of colorNames) {
		var newDuckColor = duckColors[colorName];
		var promiseLoadImg = preloadDuckColorsFromWhite(newDuckColor);
		promises.push(promiseLoadImg);
		console.log(`Preloaded overlay colors ${colorName}`, newDuckColor);
	}
	await Promise.allSettled(promises);
}

async function preloadDuckColorsFromWhite(newDuckColor) {
	if (newDuckColor.images?.t1 != null) {
		return; // already loaded.
	}
	var promises = [];
	var duckImageNames = Object.keys(duckColors.white.images);
	for (var imgName of duckImageNames) {
		const imageName = imgName; // This is required to keep the reference unchanged during the "then" function.
		var promise = replaceDuckColorsFromWhite(duckColors.white.images[imageName], newDuckColor)
		.then(r => {
			newDuckColor.images[imageName] = r?.img;
		});
		promises.push(promise);
	}
	await Promise.allSettled(promises);
}

const pinkTransparentColor = "#ff00ff";
async function replaceHatTransparentPinkWithAlerts(img){
	const r = await replaceHatTransparentPink(img.src);
	if (r == null) {
		// console.error(`Error replacing pink for file: "${hatFileName}"`, img);
		return;
	}
	img.src = r.img; // Replacing it even if no pixels were modified, because this changes the img.src
	// from: "blob:http://localhost:8000/12345678-1234-1234-1234-123456789012"
	// to: "data:image/png;base64,iV..."
	// Which is required to open the image in Photopea.com
	const pixelsReplacedCount = r?.pixelsReplaced.length;
	if (pixelsReplacedCount > 0) {
		const imageContainer = img.parentElement.parentElement;
		imageContainer.classList.add("has-transparent-pink");

		// Detect when the transparent pink color is used accidentally in a hat,
		// considering that when it is used intentionally there are a lot of pixels in pink
		// raise an alert if less than a threshold of pink pixels is used.
		const transparentPinkMinimumForAlert = 500;
		if (pixelsReplacedCount < transparentPinkMinimumForAlert) {
			imageContainer.classList.add("has-transparent-pink-extra-alert");
		}
		const maxPixelPositionsInTitle = 20;
		const showEllipsis = r.pixelsReplaced.length > maxPixelPositionsInTitle;
		const pixelList = r.pixelsReplaced.slice(0, maxPixelPositionsInTitle).join("\r") + (showEllipsis? "\r..." : "");
		imageContainer.title += `Found ${pixelsReplacedCount} pixels with transparent Pink ${pinkTransparentColor} at: \r${pixelList}`;
	}
}
async function replaceHatTransparentPink(imgSrc){
	return await tryReplaceColors(imgSrc, [
		{ oldColor: pinkTransparentColor, newColor: "#00000000" }
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
async function replaceColors(src, colorReplacementPairList) {
	const colorMap = getColorMap(colorReplacementPairList);
	const img = await loadImg(src);
	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;

	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const pixels = imageData.data;
	let pixelsReplaced = [];
	for (let i = 0; i < pixels.length; i += 4) {
		const currentPixelColor = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
		const newColor = colorMap.get(currentPixelColor);
		if (!newColor) {
			continue;
		}
		const currentPixelTransparency = pixels[i + 3];
		const isCurrentPixelTransparent = currentPixelTransparency == 0;
		const newColorHasTransparencyData = !isNaN(newColor.a);
		const isColorMatchButIsAlreadyTransparent = isCurrentPixelTransparent && !newColorHasTransparencyData;
		if (isColorMatchButIsAlreadyTransparent) {
			continue;
		}
		
		const pixelNumber = i/4;
		const pixelPositionX = pixelNumber % img.width;
		const pixelPositionY = Math.floor(pixelNumber / img.width);
		pixelsReplaced.push(`${pixelPositionY}y-${pixelPositionX}x`);

		pixels[i] = newColor.r;
		pixels[i + 1] = newColor.g;
		pixels[i + 2] = newColor.b;
		if (newColorHasTransparencyData) {
			pixels[i + 3] = newColor.a;
		}
	}
	ctx.putImageData(imageData, 0, 0);
	return { img: canvas.toDataURL("image/png"), pixelsReplaced };
}

function getColorMap(colorPairList) {
	const lookup = new Map();
	for (const pair of colorPairList) {
		const oldRgb = hexToRgb(pair.oldColor);
		const newRgb = hexToRgb(pair.newColor);
		const key = (oldRgb.r << 16) | (oldRgb.g << 8) | oldRgb.b;
		lookup.set(key, newRgb);
	}
	return lookup;
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

async function loadImg(src, image = null, setCors = true) {
	const img = image ?? new Image();
	if (setCors) {
		img.crossOrigin = "anonymous"; // Required for conversions using canvas.
	}
	await new Promise((resolve, reject) => {
		img.onload = resolve;
		img.onerror = reject;
		img.src = src;
	});
	return img;
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

async function addHatFileInfo(hat){
	var hatView = await createHatViewElement(hat.name, hat.hatFileName, hat.newFileName, hat.blob);
	hat.width= hatView.img.naturalWidth;
	hat.height= hatView.img.naturalHeight;
	if (hat.width > hatImageWidths.max) {
		const skipMessage = `Skipping HAT image too large (${hat.width}px wide, larger than max ${hatImageWidths.max})`;
		// console.error(`${skipMessage}: "${hat.hatFileName}"`, hat);
		hat.message= skipMessage;
		hat.skipped= true;
		return hat;
	}
	if (hasHatFileExtension(hat.hatFileName)) {
		hatsConverted.push(hat);
	}
	hats.push(hat);
	if (hats.length == 1) {
		setVisibleAfterLoad(true);
	}
	console.log(`Processed file: ${hat.hatFileName} -> ${hat.newFileName}.png`);
}

const hatTemplate = document.getElementById("hat-template");
async function createHatViewElement(name, hatFileName, newFileName, blob){
	const hatContainer = hatTemplate.content.cloneNode(true);
	const img = hatContainer.querySelector("img.hat-image");
	const a = hatContainer.querySelector("a");;
	const title = hatContainer.querySelector(".title");
	const imgOverlay = hatContainer.querySelector(".hat-image-overlay");
	const imgOverlayWing = hatContainer.querySelector(".hat-image-overlay-wing");

	const nameDesc = getNameDescription(name, hatFileName, newFileName)
	title.innerText = nameDesc
	title.title = `Original file name: ${hatFileName}\nHat metadata name: ${name}\nOutput file name: ${newFileName}.png`

	let imgSrc = URL.createObjectURL(blob)
	img.alt = `Image for ${hatFileName}`
	// img.title = `Download ${newFileName}.png`
	// img.src = await replaceHatTransparentPink(img.src);
	const firstChild = hatContainer.firstElementChild; // Required to keep the reference latter.
	
	
	a.download = `${newFileName}.png`
	hatsOutput.appendChild(hatContainer)

	await new Promise((resolve, reject) => {
		img.onerror = () => {
			firstChild.remove();
			img.onerror = null;
			img.onload = null;
			reject(`Error loading the file could be damaged: "${hatFileName}"`);
		};
		img.onload = () => {
			const templateIndex = getImageTemplate(img.naturalWidth);
			imgOverlay.setAttribute(customAttributeTemplateIndex, templateIndex);
			imgOverlayWing.setAttribute(customAttributeTemplateIndex, templateIndex);
			if (templateIndex > 0) {
				// Overlay imgs were hidden in the template 
				// to prevent showing the broken img icon before they load.
				imgOverlay.style.display = "";
				imgOverlayWing.style.display = "";

				imgOverlay.src = `./media/Template-${templateIndex}x.png`
				imgOverlayWing.src = `./media/Template-${templateIndex}x-wing.png`
				if (img.naturalWidth > 97) {
					imgOverlay.classList.add("hat-image-is-bigger");
					imgOverlayWing.classList.add("hat-image-is-bigger");
				}
			}
			else {
				firstChild.remove();
			}
			img.onerror = null;
			img.onload = null;
			resolve();
		};
		img.src = imgSrc;
		a.href = img.src
	});
	const promiseReplaceTransparent = replaceHatTransparentPinkWithAlerts(img);
	// await promiseReplaceTransparent;
	//promiseReplaceTransparent.then(r => a.href = img.src); // With this, the downloaded hat will have the transparent pink edited out as pure transparent.
	return { container: firstChild, img }
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

hatsOutput.addEventListener("auxclick", (e) => {
	if (e.button !== 1) {
		return;
	}
	const link = e.target.closest("a");
	if (!link || !hatsOutput.contains(link)) {
		return;
	}
	var imgHat = link.querySelector("img.hat-image");
	openImgInPhotopea(imgHat);
	e.stopPropagation();
	e.preventDefault();
});

function openImgInPhotopea(imgElement){
	if (imgElement.src != null) {
		openImgUrlInPhotopea(imgElement.src);
	}
}

// Examples:
// openImgUrlInPhotopea("https://lazaroonline.github.io/dg-hat-converter/media/Template-2x.png")
// openImgUrlInPhotopea(["https://lazaroonline.github.io/dg-hat-converter/media/Template-2x.png", "https://lazaroonline.github.io/dg-hat-converter/media/Template-1x.png"])
function openImgUrlInPhotopea(imgUrl){
	var url = createPhotopeaUrl(imgUrl);
	window.open(url, "_blank");
	console.log("Opening image in Photopea");
}

function createPhotopeaUrl(fileOrFileArray){
	// multiple file-urls results in Photopea opening multiple Photopea-tabs (not one tab with multi-layers).
	var fileList = Array.isArray(fileOrFileArray)? fileOrFileArray : [fileOrFileArray];
	var config = { files: fileList };
	var json = JSON.stringify(config);
	var url = "https://www.photopea.com#" + encodeURIComponent(json);
	return url;
}

const slider = document.getElementById('zoomSlider');
const hatViewer = document.querySelector('.duck-out');

slider.addEventListener('input', () => {
	document.documentElement.style.setProperty('--zoom', slider.value + 'px');
});

