import { Route, Switch } from "wouter";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Leasing from "./pages/Leasing";
import ListingDetail from "./pages/ListingDetail";
import Investment from "./pages/Investment";
import BrandRepresentation from "./pages/BrandRepresentation";
import LeaseAdvisory from "./pages/LeaseAdvisory";
import Consultancy from "./pages/Consultancy";
import Team from "./pages/Team";
import News from "./pages/News";
import ArticlePage from "./pages/Article";
import CaseStudyPage from "./pages/CaseStudyPage";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/leasing" component={Leasing} />
          <Route path="/leasing/:id" component={ListingDetail} />
          <Route path="/investment" component={Investment} />
          <Route path="/brand-representation" component={BrandRepresentation} />
          <Route path="/lease-advisory" component={LeaseAdvisory} />
          <Route path="/consultancy" component={Consultancy} />
          <Route path="/team" component={Team} />
          <Route path="/news" component={News} />
          <Route path="/news/:slug" component={ArticlePage} />
          <Route path="/case-studies/:slug" component={CaseStudyPage} />
          <Route>
            <div className="mx-auto max-w-6xl px-4 py-32 text-center">
              <p className="label-caps text-bgp-burgundy">Page not found</p>
            </div>
          </Route>
        </Switch>
      </main>
      <Footer />
    </div>
  );
}
