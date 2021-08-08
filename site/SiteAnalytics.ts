import { GrapherAnalytics } from "../grapher/core/GrapherAnalytics" // todo: make these less tightly coupled

export class SiteAnalytics extends GrapherAnalytics {
    logCovidCountryProfileSearch(country: string) {
        this.logToGA("COVID_COUNTRY_PROFILE_SEARCH", country)
    }

    logPageNotFoundError(url: string) {
        this.logToAmplitude("NOT_FOUND", { href: url })
        this.logToGA("Errors", "NotFound", url)
    }

    logChartsPageSearchQuery(query: string) {
        this.logToGA("ChartsPage", "Filter", query)
    }

    logPageLoad() {
        this.logToAmplitude("OWID_PAGE_LOAD")
    }

    logDataValueAnnotate(label: string) {
        this.logToGA("Hover", "data-value-annotate", label)
    }
}
