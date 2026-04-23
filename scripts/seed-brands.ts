/**
 * Brand bible seed script — imports all brands from the Brand bible spreadsheet.
 * Run with: npx tsx scripts/seed-brands.ts
 *
 * Skips any brand whose name already exists (case-insensitive).
 */

import "dotenv/config";
import { pool } from "../server/db";
import { nanoid } from "nanoid";

// ── Brand data from Brand bible spreadsheet ───────────────────────────────────
// Each entry: [name, companyType, agentNote?]
// Agent notes are stored in the description field for now.

type BrandEntry = { name: string; companyType: string; agent?: string };

const BRANDS: BrandEntry[] = [
  // ── LUXURY ──────────────────────────────────────────────────────────────────
  ...([
    "Acne Studios", "Akris", "Armani", "Alaïa", "Alberta Ferretti", "Alexander McQueen",
    "Amina Rubinacci", "Aquazzura", "Aspinal of London", "Asprey", "Azzaro", "Balenciaga",
    "Bally", "Bamford", "Bell & Ross", "Belstaff", "Blancpain", "Boggi", "Boodles",
    "Bottega Veneta", "Boucheron", "Breitling", "Bremont", "Browns", "Bulgari", "Burberry",
    "Canada Goose", "Caramel", "Carolina Herrera", "Cartier", "Casadei", "Catherine Best",
    "Celine", "Coach", "Chanel", "Chatila", "Chaumet", "Chloé", "Chopard",
    "Christian Louboutin", "Christopher Kane", "Church's", "Claudie Pierlot", "Clergerie",
    "Crockett & Jones", "Damiani", "David Morris", "De Beers", "Delvaux", "Dior",
    "Dolce & Gabbana", "Douglas Hayward", "Emilio Pucci", "Emporio Armani",
    "Ermenegildo Zegna", "Etro", "Fendi", "Fenwick", "Ferragamo", "Fortnum & Mason",
    "Furla", "Garrard", "Georg Jensen", "Gianvito Rossi", "Gieves & Hawkes", "Givenchy",
    "Goyard", "Graff", "Gucci", "Hannah Fielder", "Harry Winston", "Hermès", "Hobbs",
    "IWC", "Jaeger-LeCoultre", "J & M Davidson", "Jimmy Choo", "Johnston's of Elgin",
    "Joseph", "Karl Lagerfeld", "Kiehl's", "Laduree", "Lanvin", "Laurence Coste",
    "Linda Farrow", "Loewe", "Longchamp", "Longines", "Loro Piana", "Louis Vuitton",
    "Mackintosh", "Marc Jacobs", "Margaret Howell", "Marni", "MaxMara", "Me + Em",
    "Melissa Odabash", "Michael Kors", "Mikimoto", "Miu Miu", "Moncler", "Montblanc",
    "Moussaieff", "Moynat", "Mulberry", "Moncler", "Omega", "Panerai", "Patek Philippe",
    "Parmigiani", "Penhaligon's", "Piaget", "Polo Ralph Lauren", "Pomellato", "Prada",
    "Pringle of Scotland", "Richard Mille", "Rimowa", "Roberto Cavalli", "Roger Dubuis",
    "Roksanda", "Rolex", "Sandro", "Sergio Rossi", "Simone Rocha", "Smythson",
    "Stella McCartney", "Stephen Webster", "TAG Heuer", "Tasaki", "Tateossian", "Tiffany & Co",
    "Tod's", "Tommy Hilfiger", "Tory Burch", "Tumi", "Vacheron Constantin", "Valentino",
    "Valextra", "Vashi", "Versace", "Victoria Beckham", "Victorinox", "Vivienne Westwood",
    "Wempe", "Wolford", "Zilli", "Zimmermann",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Luxury" })),

  // ── FASHION ─────────────────────────────────────────────────────────────────
  ...([
    "7 For All Mankind", "Abercrombie & Fitch", "Agent Provocateur", "Agnès B", "Aldo",
    "All Saints", "American Eagle", "American Vintage", "Anine Bing", "Ann Summers",
    "Anthropologie", "APC", "Apricot", "Arket", "Armani Exchange", "Barbour",
    "Bershka", "Beyond Retro", "Bimba Y Lola", "Birkenstock", "Boden", "Bonpoint",
    "Boss", "Boux Avenue", "Brandy Melville", "Bravissimo", "Brora", "Calvin Klein",
    "Calzedonia", "Cambridge Satchel", "Carhartt WIP", "Castore", "Charles Tyrwhitt",
    "Chucs", "COS", "Comptoir des Cotonniers", "Dehanche", "Deichmann", "Derek Rose",
    "Diesel", "Dr Martens", "Drumohr", "END", "Eric Bompard", "Filippa K",
    "Flannels", "Fred Perry", "Free People", "French Connection", "Fusalp",
    "Ganni", "GANT", "Gap", "Gerard Darel", "Golden Goose", "H&M",
    "Hackett", "Hawes & Curtis", "Helmut Lang", "Hobbs", "Hollister",
    "Honey Birdette", "Hugo Boss", "Intimissimi", "Jack Wills", "Jigsaw",
    "JW Anderson", "KITH", "Kooples", "Lacoste", "Levi's", "LK Bennett",
    "Mango", "Margaret Howell", "Massimo Dutti", "M&S", "Menkind",
    "Miniso", "Mini Rodini", "Monki", "Monsoon", "Moose Knuckles",
    "Moss Bros", "New Look", "NEXT", "Nobody's Child", "North Face",
    "Norse Projects", "Olivia Rubin", "Orlebar Brown", "Other Stories", "Paul Smith",
    "Petit Bateau", "Phase Eight", "Polo Ralph Lauren", "Primark", "Pull & Bear",
    "Puma", "Rag & Bone", "Ralph Lauren", "Reformation", "Reiss",
    "River Island", "RIXO", "Samsoe Samsoe", "Scotch & Soda", "Seraphine",
    "Sezane", "SMCP", "Suit Supply", "Sunspel", "Superdry",
    "Supreme", "Ted Baker", "Theory", "The Little White Company", "Timberland",
    "Uniqlo", "United Colours of Benetton", "Urban Outfitters", "Vans",
    "Whistles", "Wolf & Badger", "YMC", "Zadig & Voltaire", "Zara",
    "18 Montrose", "Les Benjamins", "Castore", "Outdoor Voices", "Rei",
    "Studs", "Vuori",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Fashion" })),

  // ── ATHLEISURE ──────────────────────────────────────────────────────────────
  ...([
    "Adidas", "ALO", "Asics", "Gymshark", "Jack Wolfskin",
    "JD Sports", "Lululemon", "New Balance", "Nike", "ON",
    "Rapha", "Sports Direct", "Sweaty Betty", "Varley",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Athleisure" })),

  // ── FOOTWEAR ─────────────────────────────────────────────────────────────────
  ...([
    "Allbirds", "Aldo", "Axel Arigato", "Barker", "Baudoin et Lange",
    "Birkenstock", "Camper", "Carvela", "Cheaney Shoes", "Clarks",
    "Crockett & Jones", "Crocs", "Dr Martens", "Dune", "FitFlop",
    "Footasylum", "Footlocker", "Geox", "Gina Shoes", "Jimmy Choo",
    "Jones Bootmaker", "Joseph Cheaney & Sons", "Kick Game", "Kurt Geiger",
    "Manolo Blahnik", "Office", "Onitsuka Tiger", "Russell & Bromley",
    "Schuh", "Skechers", "Sole Trader", "Sophia Webster", "Steve Madden",
    "Superga", "UGG", "Veja", "Sarah Flint",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Footwear" })),

  // ── ACCESSORIES ─────────────────────────────────────────────────────────────
  ...([
    "Accessorize", "Ace & Tate", "APM Monaco", "Apriati Jewels", "Astrid & Miyu",
    "Bailey Nelson", "Bloobloom", "Bottletop", "Claire's", "Clulows",
    "Cubitts", "Dinny Hall", "David Yurman", "Earnest Jones", "Ecco",
    "Finlay & Co", "Folli Follie", "Furla", "Georg Jensen", "Goldsmiths",
    "Heidi Klein", "H. Samuel", "Izipizi", "Kate Spade", "Links of London",
    "LK Bennett", "Lovisa", "Luxottica", "Mappin & Webb", "Maya Magal",
    "Mejuri", "Monica Vinader", "Moscot", "Mykita", "Oliver Bonas",
    "Optical Express", "Pandora", "Samsonite", "Strathberry", "Sunglass Hut",
    "Swarovski", "Swatch", "Thomas Sabo", "Tiffany & Co", "Tom Davies",
    "TUMI", "Unode50", "Vertex", "Vision Express", "Watchfinder",
    "Watches of Switzerland", "William & Son", "Gorjana", "Karaca",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Accessories & Footwear" })),

  // ── BEAUTY / SKINCARE / FRAGRANCE ────────────────────────────────────────────
  ...([
    "Adam Grooming Atelier", "Acqua di Parma", "Aesop", "Bamford",
    "Body Shop", "Byredo", "Caudalie", "Charlotte Tilbury", "Chop Chop",
    "Code 8", "Creed", "Deciem", "Estee Lauder", "FaceGym",
    "Forrest Essentials", "Fragrance Shop", "FRESH", "Get A Drip",
    "Glossier", "Goop", "Holland and Barrett", "John Bell & Croyden",
    "KEO", "Kiehl's", "Kiko", "Laser Clinics", "L'Oreal",
    "Lush", "MAC", "Malin+Goetz", "Margaret Dabbs", "Molton Brown",
    "NARS", "Neom", "Oh My Cream", "Onda Beauty", "Paul Edmonds",
    "Penhaligons", "Regenerative Wellbeing", "Revital", "Rituals",
    "Rush", "Sarah Chapman", "Seanhanna", "Sephora", "sk:n",
    "Smilepod", "SpaceNK", "Superdrug", "Ted's Grooming Room",
    "The Organic Pharmacy", "Therapie", "Toni & Guy",
    "White & Co.", "Winky Lux",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Beauty" })),

  // ── HOMEWARES ────────────────────────────────────────────────────────────────
  ...([
    "Anthropologie", "BON TON", "Brissi", "Caravane", "Cologne & Cotton",
    "David Mellor", "Designers Guild", "Earl of East", "Evoke London",
    "Farrow & Ball", "Flying Tiger", "Gaggenau", "Habitat", "Heals",
    "Honest Jon's", "India Jane", "Jonathan Adler", "Kings of Chelsea",
    "Le Creuset", "Mamas & Papas", "Martin Moore", "Muji", "Natuzzi",
    "Nespresso", "Osborne & Little", "Poliform", "Royal Selangor",
    "Robert Dyas", "Sevenoaks Sound & Vision", "Sheridan", "Sigmar",
    "Silvera", "Smiggle", "Sofa Workshop", "Stokke", "Tempur",
    "The Conran Shop", "The White Company", "Tiger", "TOAST",
    "Tom Dixon", "Thomas Goode", "West Elm", "White Company",
    "William Yeoward", "Loaf", "Wayfair",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Homewares" })),

  // ── LIFESTYLE & HOME ─────────────────────────────────────────────────────────
  ...([
    "Waterstones",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Lifestyle & Home" })),

  // ── GIFTS & PERFUMES ─────────────────────────────────────────────────────────
  ...([
    "Adopt Parfum", "Alexeeva & Jones", "Baobab Collection", "Candles & Oud",
    "Cards Galore", "Caroline Gardner", "Charbonnel et Walker", "Clintons",
    "Diptyque", "Disney", "Endura Roses", "Flowers & Plants Co.", "Godiva",
    "Hamleys", "Hotel Chocolat", "Jo Malone", "Le Chocolat Alain Ducasse",
    "LEGO", "Le Labo", "L'Occitane", "Menkind", "Molton Brown",
    "Moyses Stevens", "Ortigia", "Rococo", "Scribbler", "Soap & Co",
    "Sook", "The Entertainer", "The Fragrance Shop", "The Perfume Shop",
    "T2 Tea", "Virgin Holidays",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Gifts & Perfumes" })),

  // ── DEPARTMENT STORES ────────────────────────────────────────────────────────
  ...([
    "Debenhams", "House of Fraser", "John Lewis", "Marks and Spencer",
    "Matalan", "Peter Jones", "Selfridges", "TK Maxx", "Waitrose & Partners",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Department Store" })),

  // ── TECHNOLOGY ───────────────────────────────────────────────────────────────
  ...([
    "Apple", "Carphone Warehouse", "Currys", "Dyson", "EE",
    "Game", "iSmash", "Jessops", "Microsoft", "Netflix",
    "Peloton", "Razor", "Samsung", "Situ Live", "Snapchat",
    "Snappy Snaps",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Technology" })),

  // ── AUTOMOTIVE ───────────────────────────────────────────────────────────────
  ...([
    "Genesis", "MV Agusta", "Polestar", "Tesla", "Vanmoof",
    "BoConcept", "KJ West One",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Automotive" })),

  // ── TELECOMS ─────────────────────────────────────────────────────────────────
  ...([
    "EE", "O2", "Sky", "Three", "Vodafone", "Iqos", "Vuse", "Wanyoo", "Xiaomi",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Telecoms" })),

  // ── GROCERY & FOODSTORES ─────────────────────────────────────────────────────
  ...([
    "Aldi", "Amazon Fresh", "Bayley & Sage", "Daylesford Organic",
    "Lidl", "Planet Organic", "Sainsbury's", "Tesco", "Waitrose",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Grocery" })),

  // ── FINANCIAL SERVICES ───────────────────────────────────────────────────────
  ...([
    "Barclays", "Halifax", "HSBC", "Lloyd's Bank", "Natwest", "Santander",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Financial Services" })),

  // ── FINE DINING ──────────────────────────────────────────────────────────────
  ...([
    "Gaucho", "Hawksmoor", "Hakkasan", "Da Henrietta", "Cora Pearl",
    "Barrafina", "Darjeeling Express", "Dishoom", "Ave Mario",
    "Bao", "Coal Office", "Flesh & Buns", "Hoppers", "Ibérica",
    "JinJuu", "La Goccia", "Lina Stores", "Nobu", "Roka",
    "Sushi Samba", "Yauatcha", "Veeraswamy", "Scalini",
    "Bar Douro", "Balthazar", "Brasserie Max", "Bluebird",
    "Cheesecake Factory", "Chotto Matte",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Fine Dining" })),

  // ── CASUAL DINING ────────────────────────────────────────────────────────────
  ...([
    "Wagamama", "Nando's", "Wahaca", "Zizzi", "Ask Italian", "Prezzo",
    "Carluccio's", "Cinnamon Kitchen", "Cinnamon Bazaar", "Masala Zone",
    "Benihana", "Big Easy", "Brindisa Kitchen", "Casa Pastor",
    "Chai Ki", "Dehesa", "Din Tai Fung", "Drake & Morgan",
    "Emilia's Crafted Pasta", "FarmerJ", "Fatto", "Flat Iron",
    "Franco Manca", "Gaucho", "Granger & Co", "Ibérica", "Imad's",
    "Island Poké", "Itsu", "Joe Blake's", "José Pizarro",
    "Kanada-Ya", "Kimchee", "Kolamba", "Korean Dinner Party",
    "La Goccia", "Le Bab", "Leon", "MamaLan", "Marugame",
    "Megan's", "Monmouth Kitchen", "Mon Plaisir", "Morty & Bob's",
    "My Old Dutch", "Naanstop Express", "Obica", "Ole & Steen",
    "Pastaio", "Patty & Bun", "Paul", "Pergola", "Piccolino",
    "Pizza Express", "Pizza Pilgrims", "Pilpel", "Plateau",
    "Polpo", "Pret a Manger", "Poke House", "Pure",
    "Real Eating Company", "RedFarm", "Roka", "Royal China",
    "Roti King", "Shake Shack", "Shoryu Ramen", "Señor Ceviche",
    "Seoul Bird", "Slim Chickens", "Sticks n Sushi", "Tapas Brindisa",
    "The Barbary", "The Breakfast Club", "The Good Egg",
    "The Indians Next Door", "The Ivy", "The Real Greek",
    "The Rum Kitchen", "The Vurger Co.", "Tonkotsu", "Truffle Burger",
    "Ugly Dumpling", "Urban Greens", "Veeraswamy", "Wahaca",
    "Wildwood Kitchen", "Wright Brothers", "Yauatcha",
    "Maxwell's", "Eataly", "Caravan",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Casual Dining" })),

  // ── QUICK SERVICE ────────────────────────────────────────────────────────────
  ...([
    "Five Guys", "Greggs", "GDK", "Itsu", "Krispy Kreme",
    "Kua'Aina", "McDonald's", "Neat Burger", "Subway", "Wasabi",
    "Chopstix", "Club Mexicana", "Fafa's", "Gas Station", "Gordon Ramsay Street Pizza",
    "Happy Face", "Homeslice", "Leon", "Marsha", "Naanstop Express",
    "Nilly's", "Punjab", "Rainbo", "Rita's", "Stax",
    "Udderlicious", "Wafflemeister", "Yum Bun", "Yolk",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Quick Service" })),

  // ── CAFÉS & COFFEE ───────────────────────────────────────────────────────────
  ...([
    "Caffe Nero", "Costa", "Starbucks", "Joe & the Juice",
    "Beany Green", "Blend & Brew", "Café Brera", "Café Volonté",
    "Caffe Concerto", "Change Please", "Chai Guys", "Chez Antoinette",
    "Cojean", "Crussh", "El & N", "Grind", "Hagen Coffee",
    "Knoops", "Le Pain Quotidien", "Notes", "Redemption Roasters",
    "Starbucks", "T4",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Café" })),

  // ── BARS & PUBS ──────────────────────────────────────────────────────────────
  ...([
    "All Bar One", "Brewdog", "Humble Grape", "Vagabond Wines",
    "Joe Blake's", "Revolution", "Revolve", "Spiritland",
    "Compagnie des vins Surnaturels", "Flare", "Grays & Feather",
    "Le Beaujolais", "The Alchemist", "The Botanist", "The Drop",
    "The Enterprise", "Uncorked", "Vinoteca",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Bar" })),

  // ── BAKERY ───────────────────────────────────────────────────────────────────
  ...([
    "Ben's Cookies", "Buns from Home", "Crosstown", "Donovan's Bakehouse",
    "Gail's", "Lola's Cupcakes", "Longboys", "Maitre Choux",
    "Moulin de la Vierge", "Ole & Steen", "Piadana Bro's",
    "Ruby Violet", "Wafflemeister",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Bakery" })),

  // ── CINEMA ───────────────────────────────────────────────────────────────────
  ...([
    "Everyman Cinema", "Vue", "The Cinema in the Arches",
    "Odeon", "Cineworld",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Cinema" })),

  // ── EXPERIENTIAL ─────────────────────────────────────────────────────────────
  ...([
    "Bounce", "Capital Karts", "Electric Shuffle", "Puttshack",
    "Birdies", "City Bouldering", "DNA VR", "Upside Down House",
    "Dreamscape",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Experiential" })),

  // ── IMMERSIVE EXPERIENCE ─────────────────────────────────────────────────────
  ...([
    "Kidzania",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Immersive Experience" })),

  // ── GAMING ───────────────────────────────────────────────────────────────────
  ...([
    "All Star Lanes", "Tank & Paddle",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Gaming" })),

  // ── FAMILY ENTERTAINMENT ─────────────────────────────────────────────────────
  ...([
    "Blue Almonds", "Hamleys",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Family Entertainment" })),

  // ── GYM & FITNESS ────────────────────────────────────────────────────────────
  ...([
    "BoomCycle", "BXR", "F45", "GymBox", "Nuffield Health",
    "Pure Sports Medicine", "Sweat by BXR", "Third Space",
    "Triyoga", "Ultimate Performance", "Virgin Active",
    "Athlete Lab",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Gym" })),

  // ── WELLNESS ─────────────────────────────────────────────────────────────────
  ...([
    "111 Cryo", "Andrew K Hair", "Atherton Cox", "Blink Brow Bar",
    "Cubex", "Cyko", "Dr Haus Dermatology", "Freedom Clinics",
    "Get A Drip", "Hari's", "London Cryo", "London Grace",
    "Margaret Dabbs", "Mark Glenn", "Massage Angels", "Melanie Grant",
    "Neil Moodie", "Pimps & Pinups", "Radio Salon", "Regenerative Wellbeing",
    "ReMind", "Rys Hair", "Sarah Chapman", "Stil Salon",
    "Therapie", "Tian Tian Market", "Young LDN",
    "Bupa", "Lyca Health", "Until",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Wellness" })),

  // ── YOGA & PILATES ───────────────────────────────────────────────────────────
  ...([
    "Triyoga", "Gym & Coffee",
  ] as string[]).map(n => ({ name: n, companyType: "Tenant - Yoga" })),
];

// ── Seed logic ────────────────────────────────────────────────────────────────

async function seedBrands() {
  const client = await pool.connect();
  try {
    // Get all existing company names (lowercase for comparison)
    const { rows: existing } = await client.query(
      `SELECT LOWER(TRIM(name)) AS name_lower FROM crm_companies`
    );
    const existingNames = new Set(existing.map((r: any) => r.name_lower as string));

    let created = 0;
    let skipped = 0;

    for (const brand of BRANDS) {
      const key = brand.name.toLowerCase().trim();
      if (existingNames.has(key)) {
        skipped++;
        continue;
      }

      const id = nanoid();
      await client.query(
        `INSERT INTO crm_companies (id, name, company_type, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, brand.name, brand.companyType]
      );
      existingNames.add(key);
      created++;
    }

    console.log(`✅ Done. Created: ${created}, Skipped (already exist): ${skipped}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seedBrands().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
