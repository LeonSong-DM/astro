import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFont = join(projectRoot, 'src/assets/fonts/lxgw-wenkai-medium.ttf');
const outputFont = join(projectRoot, 'src/assets/fonts/lxgw-wenkai-medium-subset.woff2');
const contentRoots = [join(projectRoot, 'src'), join(projectRoot, 'public')];
const textExtensions = new Set(['.astro', '.js', '.json', '.md', '.mdx', '.ts']);

const cjkRanges = [
	[0x2e80, 0x2eff],
	[0x2f00, 0x2fdf],
	[0x2ff0, 0x2fff],
	[0x3000, 0x303f],
	[0x31c0, 0x31ef],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xf900, 0xfaff],
	[0x20000, 0x2a6df],
	[0x2a700, 0x2b73f],
	[0x2b740, 0x2b81f],
	[0x2b820, 0x2ceaf],
	[0x2ceb0, 0x2ebef],
	[0x30000, 0x3134f],
	[0x31350, 0x323af],
];

function collectFiles(directory) {
	const files = [];

	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) files.push(...collectFiles(path));
		else if (textExtensions.has(extname(path))) files.push(path);
	}

	return files;
}

function isCjkCharacter(character) {
	const codePoint = character.codePointAt(0);
	return codePoint !== undefined && cjkRanges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

const characters = new Set();

for (const root of contentRoots) {
	for (const file of collectFiles(root)) {
		for (const character of readFileSync(file, 'utf8')) {
			if (isCjkCharacter(character)) characters.add(character);
		}
	}
}

const sortedCharacters = [...characters].sort(
	(a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0),
);

if (sortedCharacters.length === 0) {
	throw new Error('No CJK characters were found in src/ or public/.');
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'astro-font-subset-'));
const characterFile = join(temporaryDirectory, 'characters.txt');
const temporaryFont = join(temporaryDirectory, 'lxgw-wenkai-medium-subset.ttf');
const compressedFont = join(temporaryDirectory, 'lxgw-wenkai-medium-subset.woff2');

try {
	writeFileSync(characterFile, sortedCharacters.join(''), 'utf8');
	execFileSync(
		'pyftsubset',
		[
			sourceFont,
			`--output-file=${temporaryFont}`,
			`--text-file=${characterFile}`,
			'--layout-features=*',
			'--name-IDs=*',
			'--name-legacy',
			'--name-languages=*',
			'--notdef-glyph',
			'--notdef-outline',
			'--recommended-glyphs',
		],
		{ stdio: 'inherit' },
	);
	execFileSync('woff2_compress', [temporaryFont], { stdio: 'inherit' });
	copyFileSync(compressedFont, outputFont);
} catch (error) {
	if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
		throw new Error('pyftsubset and woff2_compress are required to generate the web font.');
	}
	throw error;
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Generated ${outputFont} with ${sortedCharacters.length} CJK characters.`);
