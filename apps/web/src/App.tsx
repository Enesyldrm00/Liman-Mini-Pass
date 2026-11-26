import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "./api/endpoints";
import { ErrorMessage, Loading } from "./components/Status";
import { SignInPage } from "./pages/SignInPage";
import { ME_QUERY_KEY } from "./queryClient";

/** Decides between the sign-in page and the panel from `GET /api/me`. */
export function App() {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe });

  if (me.isPending) {
    return <Loading />;
  }
  if (me.isError) {
    return (
      <div className="p-6">
        <ErrorMessage onRetry={() => void me.refetch()}>Could not reach Liman.</ErrorMessage>
      </div>
    );
  }
  if (me.data === null) {
    return <SignInPage />;
  }
  return <p className="p-6">Signed in as {me.data.login}</p>;
}
