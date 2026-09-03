/* Edit this file to customize the portfolio. */
const siteConfig = {
  businessName: "Don Charlie",
  photographerName: "Charlie",
  email: "hello@doncharlie.photo",
  location: "Mexico City & available worldwide",
  instagramUrl: "https://instagram.com/",
  tagline: "Portrait, editorial, and honest celebrations — photographed with warmth.",
  eyebrow: "Photographer · Mexico City",
  availability: "Now booking select commissions for 2026.",
  bio: "I photograph people as they are: expressive, unguarded, and fully present. My work blends an editorial eye with a documentary instinct, creating images that feel considered without ever feeling staged.",
  philosophy: "Whether it is a quiet portrait or a room full of celebration, I look for gesture, light, and the small in-between moments that make a story personal."
};

const portfolioItems = [
  { image: "assets/images/portfolio/portfolio-01.jpg", title: "Window Light", category: "Portraits", alt: "Woman with natural curls in warm window light", layout: "portrait" },
  { image: "assets/images/portfolio/portfolio-02.jpg", title: "Just Married", category: "Weddings", alt: "Newly married couple laughing as they leave a historic building", layout: "landscape" },
  { image: "assets/images/portfolio/portfolio-03.jpg", title: "Form & Shadow", category: "Editorial", alt: "Fashion portrait in a sculptural black dress against concrete", layout: "tall" },
  { image: "assets/images/portfolio/portfolio-04.jpg", title: "At the Table", category: "Lifestyle", alt: "Two friends preparing a meal together in a warm kitchen", layout: "landscape" },
  { image: "assets/images/portfolio/portfolio-05.jpg", title: "A Toast at Dusk", category: "Events", alt: "Guests raising glasses at an outdoor candlelit dinner", layout: "landscape" },
  { image: "assets/images/portfolio/portfolio-06.jpg", title: "Don Mateo", category: "Portraits", alt: "Older man in a cream linen suit standing in an adobe doorway", layout: "tall" },
  { image: "assets/images/portfolio/portfolio-07.jpg", title: "The Promise", category: "Weddings", alt: "Close view of newlyweds holding hands in the sunlight", layout: "portrait" },
  { image: "assets/images/portfolio/portfolio-08.jpg", title: "Movement Study", category: "Editorial", alt: "Dancer turning in a flowing rust-colored dress in a bright studio", layout: "landscape" },
  { image: "assets/images/portfolio/portfolio-09.jpg", title: "Wild Stems", category: "Lifestyle", alt: "Flower artist arranging seasonal stems at a wooden worktable", layout: "tall" },
  { image: "assets/images/portfolio/portfolio-10.jpg", title: "After Midnight", category: "Events", alt: "Trumpet player performing among dancing guests at a night celebration", layout: "portrait" }
];

const services = [
  { number: "01", name: "Portrait sessions", description: "Unhurried, collaborative portraiture for individuals, couples, artists, and families.", price: "Sessions from $—" },
  { number: "02", name: "Weddings & events", description: "Artful documentary coverage of intimate gatherings, full wedding days, and everything between.", price: "Collections from $—" },
  { number: "03", name: "Editorial & commercial", description: "Concept-led imagery for publications, designers, hospitality, and thoughtful brands.", price: "Custom estimates" },
  { number: "04", name: "Lifestyle & branding", description: "Natural visual stories that give independent businesses and creative teams a distinct point of view.", price: "Half-day and full-day rates" }
];

window.siteConfig = siteConfig;
window.portfolioItems = portfolioItems;
window.services = services;
