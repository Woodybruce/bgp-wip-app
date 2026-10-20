export interface SocialPost {
  id: string;
  provider: "Instagram" | "LinkedIn";
  account: string;
  title: string;
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  imagePosition?: string;
  url: string;
}

// Selected original BGP posts, verified for the Pave website on 20 October
// 2026. Cards link to the original posts; the Jo Loves thumbnail is a separately
// selected shop-window photograph of the same South Molton Street opening.
// Card titles use the brand names. This collection is not an automatic account feed.
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
    // Source: https://theindustry.beauty/jo-loves-opens-second-london-location-with-mayfair-pop-up/
    image: "/images/social/jo-loves-south-molton-window.jpg",
    imageAlt: "The Jo Loves South Molton Street shop window and fragrance display",
    imageWidth: 1206,
    imageHeight: 2084,
    imagePosition: "center 60%",
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7516770645708333057/",
  },
];
