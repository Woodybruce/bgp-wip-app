export interface SocialPost {
  id: string;
  provider: "Instagram" | "LinkedIn";
  account: string;
  title: string;
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  url: string;
}

// Selected original BGP posts, verified for the Pave website on 20 October
// 2026. Local images are the original post media; card titles use the brand
// names rather than newly written summaries. This collection is not an automatic account feed.
export const SOCIAL_POSTS: readonly SocialPost[] = [
  {
    id: "gopals-corner",
    provider: "Instagram",
    account: "BGP",
    title: "Gopal’s Corner",
    image: "/images/social/bgp-gopals-corner.jpg",
    imageAlt: "Gopal’s Corner Malaysian street-food counter at Bullring & Grand Central",
    imageWidth: 1163,
    imageHeight: 1095,
    url: "https://www.instagram.com/p/DegiIA0iBsm/",
  },
  {
    id: "jo-loves",
    provider: "LinkedIn",
    account: "BGP",
    title: "Jo Loves",
    image: "/images/social/bgp-jo-loves.jpg",
    imageAlt: "Jo Loves products and a red gift display in the photograph shared by BGP",
    imageWidth: 1024,
    imageHeight: 576,
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7516770645708333057/",
  },
];
