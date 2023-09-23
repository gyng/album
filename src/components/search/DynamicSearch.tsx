import dynamic from "next/dynamic";

export default dynamic(() => import("./Search"), {
  loading: () => <p>Loading...</p>,
});
