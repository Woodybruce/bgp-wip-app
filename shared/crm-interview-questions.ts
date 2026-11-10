// The Phase 1 question set, verbatim from the strategy doc.
export const CRM_INTERVIEW_SECTIONS: { title: string; note?: string; questions: { id: string; text: string }[] }[] = [
  {
    title: "Current practice",
    questions: [
      { id: "cp1", text: "How do you currently track clients, prospects, and deals? (Outlook, Excel, memory, existing CRM?)" },
      { id: "cp2", text: "What does 'the pipeline' look like for your team today — is it written down anywhere?" },
      { id: "cp3", text: "Which 3 clients have paid the most fees to your team in the last 2 years?" },
      { id: "cp4", text: "How do you currently decide who to call/visit and when?" },
    ],
  },
  {
    title: "Relationship landscape",
    questions: [
      { id: "rl1", text: "Who are your top 15–20 relationships (landlords/investors/occupiers/agents) that generate the most repeat work?" },
      { id: "rl2", text: "Which relationships are at risk, dormant, or under-serviced?" },
      { id: "rl3", text: "Which relationships overlap with other teams that you know of?" },
    ],
  },
  {
    title: "New business",
    questions: [
      { id: "nb1", text: "How do new instructions currently arrive — referral, cold approach, tender, repeat client?" },
      { id: "nb2", text: "What targeting do you currently do (by sector, geography, asset type)?" },
    ],
  },
  {
    title: "Pain points & wishlist",
    questions: [
      { id: "pp1", text: "What's the single biggest reason a relationship or opportunity has been dropped in the past 12 months?" },
      { id: "pp2", text: "If you had one tool/process that would make your team's BD easier, what would it be?" },
    ],
  },
  {
    title: "Team members",
    note: "CRM is for every employee and crucial for organic company growth and personal career development — juniors must be included in all meetings where appropriate.",
    questions: [
      { id: "tm1", text: "What are junior members of the team doing for CRM?" },
      { id: "tm2", text: "How can senior members help them build their network?" },
    ],
  },
];

export const CRM_INTERVIEW_QUESTIONS = CRM_INTERVIEW_SECTIONS.flatMap(section => section.questions);

export const CRM_INTERVIEW_QUESTION_LABELS: Record<string, string> = {"cp1": "How the team tracks work", "cp2": "Current pipeline", "cp3": "Top fee clients", "cp4": "Contact planning", "rl1": "Repeat-work relationships", "rl2": "Relationships needing attention", "rl3": "Cross-team relationships", "nb1": "Sources of new instructions", "nb2": "Targeting priorities", "pp1": "Missed opportunities", "pp2": "Process improvements", "tm1": "Junior team involvement", "tm2": "Building the team’s network"};
