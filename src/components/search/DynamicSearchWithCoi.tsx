import dynamic from "next/dynamic";

export default dynamic(() => import("./SearchWithCoi"), {
  loading: () => <p>Loading...</p>,
});
