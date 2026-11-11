// Builds packages/core/growth/nutrition/foods.json from USDA FoodData Central (SR Legacy, April 2018 CSV), which is in the
// public domain (CC0 1.0): "No permission is needed for their use", https://fdc.nal.usda.gov/api-guide/ . We keep only the
// foods our meals use and, per 100 g, energy (kcal), protein, fat, carbohydrate, fibre (g) and sodium (mg). Local foods
// are linked to the nearest FDC record (beyaz peynir -> feta, lavaş -> white pita); the page marks values "approximate".
// Usage: node tools/food-data/build.mjs --src <folder with food_nutrient.csv> (unzipped from the FDC download)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
if (!argv.includes('--src')) { console.error('Usage: node tools/food-data/build.mjs --src <folder>'); process.exit(2); }
const src = resolve(argv[argv.indexOf('--src') + 1]);

// key: [FDC id, aisle, buy unit grams (pack or piece) or 0 for loose weight, piece grams (0 = sold by weight)]
export const FOODS = {
  egg: [171287, 'dairy', 0, 50], wholeBread: [172688, 'bakery', 500, 0], whiteCheese: [173420, 'dairy', 250, 0], tomato: [170457, 'produce', 0, 120],
  greenPepper: [170427, 'produce', 0, 120], redPepper: [170108, 'produce', 0, 150], oliveOil: [171413, 'pantry', 500, 0], lentils: [172421, 'pantry', 500, 0],
  bulgur: [170287, 'pantry', 500, 0], yogurt: [171284, 'dairy', 500, 0], cucumber: [168409, 'produce', 0, 200], chickenBreast: [171477, 'meat', 500, 0],
  chickenThigh: [172388, 'meat', 500, 0], greenBeans: [169961, 'produce', 500, 0], chickpeas: [173757, 'pantry', 400, 0], spinach: [168462, 'produce', 250, 0],
  onion: [170000, 'produce', 0, 110], rice: [168878, 'pantry', 1000, 0], brownRice: [169704, 'pantry', 1000, 0], oats: [169705, 'pantry', 500, 0],
  milk: [171267, 'dairy', 1000, 0], banana: [173944, 'produce', 0, 120], apple: [171688, 'produce', 0, 180], potato: [170093, 'produce', 1000, 0],
  salmon: [175168, 'meat', 300, 0], tuna: [173709, 'pantry', 160, 0], pasta: [169737, 'pantry', 500, 0], beef: [171794, 'meat', 500, 0],
  tofu: [172475, 'dairy', 400, 0], almonds: [170567, 'pantry', 200, 0], walnuts: [170187, 'pantry', 200, 0], peanutButter: [172470, 'pantry', 350, 0],
  carrot: [170393, 'produce', 0, 70], broccoli: [170379, 'produce', 500, 0], lettuce: [169247, 'produce', 0, 400], avocado: [171705, 'produce', 0, 150],
  blackBeans: [173735, 'pantry', 400, 0], cornTortilla: [173241, 'bakery', 300, 0], cheddar: [170899, 'dairy', 200, 0], cottage: [172182, 'dairy', 250, 0],
  mozzarella: [170847, 'dairy', 125, 0], ryeBread: [172684, 'bakery', 500, 0], lemon: [167746, 'produce', 0, 60], garlic: [169230, 'produce', 0, 5],
  mushroom: [169251, 'produce', 250, 0], zucchini: [169291, 'produce', 0, 200], eggplant: [169228, 'produce', 0, 300], orange: [169097, 'produce', 0, 150],
  strawberry: [167762, 'produce', 250, 0], blueberry: [171711, 'frozen', 300, 0], honey: [169640, 'pantry', 450, 0], butter: [173410, 'dairy', 250, 0],
  turkey: [174519, 'meat', 300, 0], kidneyBeans: [175194, 'pantry', 400, 0], peas: [170017, 'frozen', 450, 0], corn: [168397, 'pantry', 300, 0],
  quinoa: [168917, 'pantry', 500, 0], couscous: [169700, 'pantry', 500, 0], hummus: [172454, 'dairy', 200, 0], tomatoSauce: [170054, 'pantry', 400, 0],
  sauerkraut: [169279, 'pantry', 500, 0], cabbage: [169975, 'produce', 0, 900], cauliflower: [169986, 'produce', 0, 600], pear: [167776, 'produce', 0, 170],
  grapes: [174683, 'produce', 500, 0], soymilk: [172456, 'dairy', 1000, 0], parmesan: [170848, 'dairy', 100, 0], swiss: [171251, 'dairy', 200, 0],
  pita: [174916, 'bakery', 400, 0], whitePita: [174915, 'bakery', 400, 0], sweetPotato: [168483, 'produce', 0, 200], olives: [169094, 'pantry', 200, 0],
  cod: [171956, 'meat', 400, 0], lamb: [172544, 'meat', 500, 0], kefir: [170904, 'dairy', 1000, 0], parsley: [170416, 'produce', 0, 50],
  dill: [172233, 'produce', 0, 30], hazelnuts: [170581, 'pantry', 200, 0], dates: [168191, 'pantry', 250, 0], eggNoodles: [168919, 'pantry', 500, 0],
  mint: [173475, 'produce', 0, 30], pork: [168250, 'meat', 500, 0],
};

const NUTRIENTS = { 1008: 'kcal', 1003: 'p', 1004: 'f', 1005: 'c', 1079: 'fib', 1093: 'na' };
const want = new Map(Object.entries(FOODS).map(([k, v]) => [String(v[0]), k]));
const values = Object.fromEntries(Object.keys(FOODS).map((k) => [k, {}]));
const text = readFileSync(join(src, 'food_nutrient.csv'), 'utf8');
let first = true;
for (const line of text.split('\n')) {
  if (first) { first = false; continue; }
  if (!line) continue;
  // "id","fdc_id","nutrient_id","amount",...
  const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
  const key = want.get(cells[1]);
  if (!key) continue;
  const n = NUTRIENTS[cells[2]];
  if (n) values[key][n] = Number(cells[3]);
}
const out = {};
for (const [k, v] of Object.entries(values)) {
  if (v.kcal === undefined || v.p === undefined) throw new Error(`missing energy or protein for ${k}`);
  const [id, aisle, pack, piece] = FOODS[k];
  out[k] = { fdc: id, kcal: v.kcal, p: v.p, f: v.f ?? 0, c: v.c ?? 0, fib: v.fib ?? 0, na: v.na ?? 0, aisle, pack, piece };
}
const file = join(root, 'packages/core/growth/nutrition/foods.json');
writeFileSync(file, JSON.stringify({ source: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, SR Legacy (2018-04). fdc.nal.usda.gov. Public domain (CC0 1.0).', per: '100 g', foods: out }, null, 0) + '\n');
console.log(`foods.json: ${Object.keys(out).length} foods`);
