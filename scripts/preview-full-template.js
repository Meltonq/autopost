import path from "path";
import { loadTheme } from "../src/themeLoader.js";
import { buildPrompt } from "../src/generator/prompt.js";

const themesDir = path.resolve("./src/themes");
const { theme } = loadTheme("coaching40plus", { themesDir });

const rubric = "clarity";
const tone = "тепло";
const cta = "Напиши «Хочу», если откликается.";

const prompt = buildPrompt({ theme, rubric, tone, cta, brief: "" });

console.log("--- system ---");
console.log(prompt.system);
console.log("--- user ---");
console.log(prompt.user);
