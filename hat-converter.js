/*

Web interface events and listeners

*/
const dlAllLink = document.getElementById("downloadZip")

// handle file "uploads"
async function handleFiles(files) {
	dlAllLink.hidden = true;
	const fileList = Array.from(files || this.files);
	console.log(`Started processing ${fileList.length} files in total.`);
	const promises = [];
	const BATCH_SIZE = 100;
	const allResults = [];
	for (let start = 0; start < fileList.length; start += BATCH_SIZE) {
		const batch = fileList.slice(start, start + BATCH_SIZE);
		console.log(`Started processing batch ${batch.length} files...`);
		const batchPromises = batch.map(file => getHatFileInfo(file));
		const results = await Promise.allSettled(batchPromises);
		promises.push(...results);
	}
	const hatList = await Promise.all(promises);
	console.log(hatList)
	createZip()
	console.log(`Finished processing all ${fileList.length} files into ${hats.length} hats.`);
	dlAllLink.hidden = false;
}

function getHatFileInfo(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (result) => {
			decryptHat(result.target.result).then((r) => {
				const nameSanitized = sanitizeFileName(r.name);
				const nameSanitizedUnique = makeUniqueFileName(nameSanitized, hats.map(h => h.newFileName));
				// "name" is the metadata inside the hat file.
				// "hatFileName" is the original .hat file name.
				// "newFileName" is the sanitized and made-unique name for the output PNG.
				const h = { name: r.name, hatFileName: file.name, newFileName: nameSanitizedUnique, blob: r.blob }
				const alreadyExistingHat = existHat(h, hats);
				if (alreadyExistingHat) {
					console.warn(`Hat "${h.name}" with ${h.blob.size} bytes already exists. Skipping duplicate: ${h.hatFileName} (already added from: "${alreadyExistingHat.hatFileName}")`);
				}
				else {
					hats.push(h);
					createOutputElem(h.name, h.hatFileName, h.newFileName, h.blob);
					console.log(`Processed file: ${h.hatFileName} -> ${h.name}`);
				}
				resolve(h);
			})
		}
		reader.readAsArrayBuffer(file);
	})
}

const inputElement = document.getElementById("upload");
inputElement.addEventListener("change", handleFiles, false);

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
dropbox.addEventListener("dragenter", dragenter, false);
dropbox.addEventListener("dragover", dragover, false);
dropbox.addEventListener("drop", drop, false);
dropbox.addEventListener("dragleave", dragend, false);
dropbox.addEventListener("dragend", dragend, false);

/*

Hat decoder

*/
const hats = []
let unnamedCounter = 0

// https://github.com/penguinscode/Quackhead/blob/2681ee7b71a57ab235742a24399babfe323b3ac5/quackhead.js#L14
const keyb64 = "8xaYIAH0em9hKg0CEw8t5g==";
const keyBytes = Uint8Array.from(atob(keyb64), c => c.charCodeAt(0))
let key;
crypto.subtle.importKey(
	"raw",
	keyBytes,
	{ name: "AES-CBC" },
	false,
	["decrypt"]
).then(r => key = r);

function decryptHat(hatByteArray){
	const ivLength = new DataView(hatByteArray.slice(0, 4)).getUint8()
	const iv = hatByteArray.slice(4, 4+ivLength)
	return window.crypto.subtle.decrypt(
		{
		  name: "AES-CBC",
		  iv: iv
		},
		key,
		hatByteArray.slice(20)
	).then((r) => parseMetadata(r))
}

function parseMetadata(hatByteArray) {
	return new Promise((resolve, reject) => {
		try{
			const hatNameLength = new DataView(hatByteArray.slice(8, 9)).getUint8()
			const hatName = hatByteArray.slice(9, 9+hatNameLength)
			let t = new TextDecoder()
			let nameDecoded = t.decode(hatName)
	
			const blob = new Blob([hatByteArray.slice(9+hatNameLength+4)], {
				type: "image/png"
			})
			
			const name = nameDecoded || `unnamed hat ${unnamedCounter}`
			if(!nameDecoded) {
				console.warn(`Hat name is empty. Using default name: ${name}`)
				unnamedCounter++
			}
			const sanitizedName = sanitizeHatMetadataName(name)
			const hatInfo = { name: sanitizedName, fileName: name, blob: blob }
			//hats.push(hatInfo)
			//console.log(`Hat parsed: ${sanitizedName}`)

			resolve(hatInfo)
		} catch(e) {
			console.error(e)
			reject(e)
		}
	})
}

const invalidFileNameChars = '/\\:*?"<>|';

function makeUniqueFileName(name, existingNames) {
	let nameUnique = name
	let counter = 1
	while(existingNames.some(n => n.toLowerCase() === nameUnique.toLowerCase())) {
		nameUnique = name +"_" + counter
		console.warn(`File name "${name}" already exists. Trying "${nameUnique}"...`)
		counter++
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

function removeHatDuplicates() {
	const seen = new Set();
	for(let i = 0; i < hats.length; i++) {
		const hat = hats[i];
		const key = `${hat.name}|${hat.blob.size}`;
		if (!seen.has(key)) {
			seen.add(key);
		}
		else {
			hats.splice(i, 1);
			i--;
		}
	}
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
	document.getElementById("out").appendChild(cont)
}

function createZip(){
	var zip = new JSZip();

	hats.forEach(hat => {
		let fn = hat.newFileName
		while(zip.file(`${fn}.png`)){
			fn = `${fn}_`
		}
		zip.file(`${fn}.png`, hat.blob)
	})

	zip.generateAsync({type:"blob"})
	.then(function(content) {
		dlAllLink.href = URL.createObjectURL(content)
		dlAllLink.download = "hats.zip"
	});
}
