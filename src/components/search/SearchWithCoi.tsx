import Head from "next/head";
import React, { useCallback, useEffect, useState } from "react";
import Search from "./Search";

function useCoi() {
  const [coiLoaded, setCoiLoaded] = useState(false);
  const [hasServiceWorker, setHasServiceWorker] = useState(true);

  useEffect(() => {
    setHasServiceWorker(!!navigator.serviceWorker);
  }, []);

  const checkLoop = useCallback(async () => {
    const isCoiActive = async () => {
      if (!navigator.serviceWorker) {
        return false;
      }

      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.find(
        (r) =>
          r.active &&
          r.active.scriptURL.endsWith("coi-serviceworker.js") &&
          r.active.state === "activated",
      );
    };

    const isActive = await isCoiActive();
    if (!isActive) {
      setCoiLoaded(false);
      setTimeout(checkLoop, 1000);
    } else {
      setCoiLoaded(true);
    }
  }, []);

  useEffect(() => {
    setTimeout(checkLoop);
  }, [checkLoop]);

  return {
    script: (
      <Head>
        <script src="/coi-serviceworker.js"></script>
      </Head>
    ),
    coiLoaded,
    hasServiceWorker,
  };
}

export const SearchWithCoi: React.FC<{}> = (props) => {
  const { script, coiLoaded, hasServiceWorker } = useCoi();

  return (
    <>
      {script}
      <Search disabled={!hasServiceWorker && !coiLoaded} />
    </>
  );
};

export default SearchWithCoi;
