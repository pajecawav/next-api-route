export default {
	"*.{js,jsx,ts,tsx,cjs,cts,json,md,yml,css}": filenames =>
		`prettier --write ${filenames.map(filename => `'${filename}'`).join(" ")}`,
	"src/**/*.{js,jsx,ts,tsx}": () => "pnpm lint:tsc",
};
