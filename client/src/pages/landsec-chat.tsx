// Chat for a Landsec joint agent (/landsec/chat): the Chat tab on a phone,
// and where a notification or the old chat addresses land. Every other login
// has the ChatBGP rail and Messages, and is pointed there.
import { useQuery } from "@tanstack/react-query";
import { JointAgentChat } from "@/components/landsec/joint-agent-chat";

export default function LandsecChat() {
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  if (isLoading || !user) return null;
  if (user.landsecRole !== "joint_agent") {
    return <p className="p-4 md:p-6 text-sm text-muted-foreground" data-testid="landsec-chat-other">Chat is the ChatBGP rail on the right of every page, and the Chat tab on a phone.</p>;
  }
  return (
    <div className="h-full min-h-0 md:mx-auto md:max-w-3xl md:border-x" data-testid="landsec-chat">
      <JointAgentChat variant="page" />
    </div>
  );
}
