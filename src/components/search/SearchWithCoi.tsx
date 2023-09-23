import Head from "next/head";
import { useEffect, useState } from "react";
import Search from "./Search";

export const SearchWithCoi = () => {
  const [coiLoaded, setCoiLoaded] = useState(false);

  const checkLoop = async () => {
    const isCoiActive = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.find(
        (r) =>
          r.active &&
          r.active.scriptURL.endsWith("coi-serviceworker.js") &&
          r.active.state === "activated"
      );
    };

    const isActive = await isCoiActive();
    if (!isActive) {
      setCoiLoaded(false);
      setTimeout(checkLoop, 1000);
    } else {
      setCoiLoaded(true);
    }
  };

  useEffect(() => {
    setTimeout(checkLoop);
  }, []);

  return (
    <>
      <Head>
        <script src="/coi-serviceworker.js"></script>
      </Head>
      <Search disabled={!coiLoaded} />
    </>
  );
};

export default SearchWithCoi;
