import { ambitiousLint } from "@ambitious/lint";

export default ambitiousLint({ root: import.meta.dirname, ignores: ["release/**", ".kit-source/**", ".kit-assets/**", ".scratch/**"] });
