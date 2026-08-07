import type { ContactSheetProps } from "./ContactSheet";
import { useClientComponents } from "./platform";

export const ContactSheetDeferred: React.FC<ContactSheetProps> = (props) => {
  const { ContactSheet } = useClientComponents();
  return <ContactSheet {...props} />;
};
