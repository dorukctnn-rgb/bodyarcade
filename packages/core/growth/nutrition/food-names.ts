// Shop names of the foods in foods.json, in the site's five languages: [en, tr, de, es, fr].
import type { Lang } from '../../ui/i18n/index.ts';

type N = readonly [string, string, string, string, string];
const T: Readonly<Record<string, N>> = {
  egg: ['Eggs', 'Yumurta', 'Eier', 'Huevos', 'Œufs'], wholeBread: ['Wholemeal bread', 'Tam buğday ekmeği', 'Vollkornbrot', 'Pan integral', 'Pain complet'],
  whiteCheese: ['White cheese (feta)', 'Beyaz peynir', 'Weißkäse (Feta)', 'Queso blanco (feta)', 'Fromage blanc (feta)'], tomato: ['Tomatoes', 'Domates', 'Tomaten', 'Tomates', 'Tomates'],
  greenPepper: ['Green peppers', 'Yeşil biber', 'Grüne Paprika', 'Pimientos verdes', 'Poivrons verts'], redPepper: ['Red peppers', 'Kırmızı biber', 'Rote Paprika', 'Pimientos rojos', 'Poivrons rouges'],
  oliveOil: ['Olive oil', 'Zeytinyağı', 'Olivenöl', 'Aceite de oliva', 'Huile d’olive'], lentils: ['Lentils (dry)', 'Mercimek (kuru)', 'Linsen (trocken)', 'Lentejas (secas)', 'Lentilles (sèches)'],
  bulgur: ['Bulgur (dry)', 'Bulgur (kuru)', 'Bulgur (trocken)', 'Bulgur (seco)', 'Boulgour (sec)'], yogurt: ['Plain yoghurt', 'Yoğurt', 'Naturjoghurt', 'Yogur natural', 'Yaourt nature'],
  cucumber: ['Cucumbers', 'Salatalık', 'Gurken', 'Pepinos', 'Concombres'], chickenBreast: ['Chicken breast', 'Tavuk göğsü', 'Hähnchenbrust', 'Pechuga de pollo', 'Blanc de poulet'],
  chickenThigh: ['Chicken thighs', 'Tavuk but', 'Hähnchenschenkel', 'Muslos de pollo', 'Cuisses de poulet'], greenBeans: ['Green beans', 'Taze fasulye', 'Grüne Bohnen', 'Judías verdes', 'Haricots verts'],
  chickpeas: ['Chickpeas (cooked)', 'Nohut (haşlanmış)', 'Kichererbsen (gekocht)', 'Garbanzos (cocidos)', 'Pois chiches (cuits)'], spinach: ['Spinach', 'Ispanak', 'Spinat', 'Espinacas', 'Épinards'],
  onion: ['Onions', 'Soğan', 'Zwiebeln', 'Cebollas', 'Oignons'], rice: ['Rice (dry)', 'Pirinç (kuru)', 'Reis (trocken)', 'Arroz (seco)', 'Riz (sec)'], brownRice: ['Brown rice (dry)', 'Esmer pirinç (kuru)', 'Naturreis (trocken)', 'Arroz integral (seco)', 'Riz complet (sec)'],
  oats: ['Rolled oats', 'Yulaf ezmesi', 'Haferflocken', 'Copos de avena', 'Flocons d’avoine'], milk: ['Milk', 'Süt', 'Milch', 'Leche', 'Lait'], banana: ['Bananas', 'Muz', 'Bananen', 'Plátanos', 'Bananes'],
  apple: ['Apples', 'Elma', 'Äpfel', 'Manzanas', 'Pommes'], potato: ['Potatoes', 'Patates', 'Kartoffeln', 'Patatas', 'Pommes de terre'], salmon: ['Salmon', 'Somon', 'Lachs', 'Salmón', 'Saumon'],
  tuna: ['Tuna in water (tin)', 'Ton balığı (konserve)', 'Thunfisch im Wasser (Dose)', 'Atún al natural (lata)', 'Thon au naturel (boîte)'], pasta: ['Pasta (dry)', 'Makarna (kuru)', 'Nudeln (trocken)', 'Pasta (seca)', 'Pâtes (sèches)'],
  beef: ['Lean minced beef', 'Az yağlı dana kıyma', 'Mageres Rinderhack', 'Carne picada magra', 'Bœuf haché maigre'], tofu: ['Firm tofu', 'Sert tofu', 'Fester Tofu', 'Tofu firme', 'Tofu ferme'],
  almonds: ['Almonds', 'Badem', 'Mandeln', 'Almendras', 'Amandes'], walnuts: ['Walnuts', 'Ceviz', 'Walnüsse', 'Nueces', 'Noix'], peanutButter: ['Peanut butter', 'Yer fıstığı ezmesi', 'Erdnussbutter', 'Crema de cacahuete', 'Beurre de cacahuète'],
  carrot: ['Carrots', 'Havuç', 'Karotten', 'Zanahorias', 'Carottes'], broccoli: ['Broccoli', 'Brokoli', 'Brokkoli', 'Brócoli', 'Brocoli'], lettuce: ['Lettuce', 'Marul', 'Salat', 'Lechuga', 'Laitue'],
  avocado: ['Avocados', 'Avokado', 'Avocados', 'Aguacates', 'Avocats'], blackBeans: ['Black beans (cooked)', 'Siyah fasulye (haşlanmış)', 'Schwarze Bohnen (gekocht)', 'Frijoles negros (cocidos)', 'Haricots noirs (cuits)'],
  cornTortilla: ['Corn tortillas', 'Mısır tortilla', 'Maistortillas', 'Tortillas de maíz', 'Tortillas de maïs'], cheddar: ['Cheddar', 'Çedar', 'Cheddar', 'Queso cheddar', 'Cheddar'],
  cottage: ['Cottage cheese', 'Lor peyniri', 'Hüttenkäse', 'Requesón', 'Cottage'], mozzarella: ['Mozzarella', 'Mozzarella', 'Mozzarella', 'Mozzarella', 'Mozzarella'], ryeBread: ['Rye bread', 'Çavdar ekmeği', 'Roggenbrot', 'Pan de centeno', 'Pain de seigle'],
  lemon: ['Lemons', 'Limon', 'Zitronen', 'Limones', 'Citrons'], garlic: ['Garlic', 'Sarımsak', 'Knoblauch', 'Ajo', 'Ail'], mushroom: ['Mushrooms', 'Mantar', 'Champignons', 'Champiñones', 'Champignons'],
  zucchini: ['Courgettes', 'Kabak', 'Zucchini', 'Calabacines', 'Courgettes'], eggplant: ['Aubergines', 'Patlıcan', 'Auberginen', 'Berenjenas', 'Aubergines'], orange: ['Oranges', 'Portakal', 'Orangen', 'Naranjas', 'Oranges'],
  strawberry: ['Strawberries', 'Çilek', 'Erdbeeren', 'Fresas', 'Fraises'], blueberry: ['Blueberries', 'Yaban mersini', 'Heidelbeeren', 'Arándanos', 'Myrtilles'], honey: ['Honey', 'Bal', 'Honig', 'Miel', 'Miel'],
  butter: ['Butter', 'Tereyağı', 'Butter', 'Mantequilla', 'Beurre'], turkey: ['Turkey breast', 'Hindi göğsü', 'Truthahnbrust', 'Pechuga de pavo', 'Blanc de dinde'],
  kidneyBeans: ['Red kidney beans (cooked)', 'Barbunya (haşlanmış)', 'Kidneybohnen (gekocht)', 'Alubias rojas (cocidas)', 'Haricots rouges (cuits)'], peas: ['Peas (frozen)', 'Bezelye (dondurulmuş)', 'Erbsen (TK)', 'Guisantes (congelados)', 'Petits pois (surgelés)'],
  corn: ['Sweetcorn (tin)', 'Mısır (konserve)', 'Mais (Dose)', 'Maíz (lata)', 'Maïs (boîte)'], quinoa: ['Quinoa (dry)', 'Kinoa (kuru)', 'Quinoa (trocken)', 'Quinoa (seca)', 'Quinoa (sec)'],
  couscous: ['Couscous (dry)', 'Kuskus (kuru)', 'Couscous (trocken)', 'Cuscús (seco)', 'Couscous (sec)'], hummus: ['Hummus', 'Humus', 'Hummus', 'Hummus', 'Houmous'],
  tomatoSauce: ['Tomato sauce', 'Domates sosu', 'Tomatensoße', 'Salsa de tomate', 'Sauce tomate'], sauerkraut: ['Sauerkraut', 'Lahana turşusu', 'Sauerkraut', 'Chucrut', 'Choucroute'],
  cabbage: ['Cabbage', 'Lahana', 'Weißkohl', 'Col', 'Chou'], cauliflower: ['Cauliflower', 'Karnabahar', 'Blumenkohl', 'Coliflor', 'Chou-fleur'], pear: ['Pears', 'Armut', 'Birnen', 'Peras', 'Poires'],
  grapes: ['Grapes', 'Üzüm', 'Trauben', 'Uvas', 'Raisin'], soymilk: ['Soy drink', 'Soya içeceği', 'Sojadrink', 'Bebida de soja', 'Boisson au soja'], parmesan: ['Parmesan', 'Parmesan', 'Parmesan', 'Parmesano', 'Parmesan'],
  swiss: ['Swiss cheese', 'Kaşar tipi peynir', 'Emmentaler', 'Queso suizo', 'Emmental'], pita: ['Wholemeal pita', 'Tam buğday pide', 'Vollkorn-Pita', 'Pan pita integral', 'Pita complète'],
  whitePita: ['Flatbread (lavaş)', 'Lavaş', 'Fladenbrot (Lavash)', 'Pan plano (lavash)', 'Galette (lavash)'], sweetPotato: ['Sweet potatoes', 'Tatlı patates', 'Süßkartoffeln', 'Boniatos', 'Patates douces'],
  olives: ['Olives', 'Zeytin', 'Oliven', 'Aceitunas', 'Olives'], cod: ['Cod', 'Morina', 'Kabeljau', 'Bacalao', 'Cabillaud'], lamb: ['Minced lamb', 'Kuzu kıyma', 'Lammhack', 'Cordero picado', 'Agneau haché'],
  kefir: ['Kefir', 'Kefir', 'Kefir', 'Kéfir', 'Kéfir'], parsley: ['Parsley', 'Maydanoz', 'Petersilie', 'Perejil', 'Persil'], dill: ['Dill', 'Dereotu', 'Dill', 'Eneldo', 'Aneth'],
  hazelnuts: ['Hazelnuts', 'Fındık', 'Haselnüsse', 'Avellanas', 'Noisettes'], dates: ['Dates', 'Hurma', 'Datteln', 'Dátiles', 'Dattes'], eggNoodles: ['Egg noodles (dry)', 'Yumurtalı erişte (kuru)', 'Eiernudeln (trocken)', 'Fideos de huevo (secos)', 'Nouilles aux œufs (sèches)'],
  mint: ['Mint', 'Nane', 'Minze', 'Menta', 'Menthe'], pork: ['Pork tenderloin', 'Domuz bonfile', 'Schweinefilet', 'Solomillo de cerdo', 'Filet mignon de porc'],
};
const I: Record<Lang, number> = { en: 0, tr: 1, de: 2, es: 3, fr: 4 };
export const foodName = (key: string, lang: Lang): string => T[key]?.[I[lang]] ?? key;
export const FOOD_NAME_KEYS: readonly string[] = Object.keys(T);
