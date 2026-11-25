// Setting up a new property (Woody, 23 November 2026: "when we set up a new
// property should ask before its set up some basic questions I think? correct
// address? then documents where do we want the files options are existing
// folder with a pop out to the BGP share drive and ability to go in and pick a
// folder. or create new folder tree. Add joint agent and tenancy schedule or
// areas schedule for marketing and add brochure and add plans").
//
// The steps, in order, each one skippable. The dialog is
// client/src/components/property-page/property-setup.tsx; its folder rules are
// the folder engine's (shared/folders.ts).

export const SETUP_STEPS = [
  { key: "address", label: "Address" },
  { key: "owner", label: "Owner" },
  { key: "files", label: "Files" },
  { key: "agent", label: "Joint agent" },
  { key: "schedule", label: "Schedule" },
  { key: "brochure", label: "Brochure" },
  { key: "plans", label: "Plans" },
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];
