import {type APIGuildScheduledEvent, GuildScheduledEventStatus} from 'discord-api-types/v10';
import {
	ICalCalendar,
	type ICalCalendarData,
	ICalEventRepeatingFreq,
	ICalEventStatus,
	type ICalRepeatingOptions,
	ICalWeekday,
} from 'ical-generator';

type Env = {
	DISCORD_TOKEN: string;
	DISCORD_GUILD_ID: string;
	KV: KVNamespace;
};

enum RRuleFrequencies {
	Yearly = 0,
	Monthly = 1,
	Weekly = 2,
	Daily = 3,
}

const RRuleFrequenciesToICalEventRepeatingFreq: Record<RRuleFrequencies, ICalEventRepeatingFreq> = {
	[RRuleFrequencies.Yearly]: ICalEventRepeatingFreq.YEARLY,
	[RRuleFrequencies.Monthly]: ICalEventRepeatingFreq.MONTHLY,
	[RRuleFrequencies.Weekly]: ICalEventRepeatingFreq.WEEKLY,
	[RRuleFrequencies.Daily]: ICalEventRepeatingFreq.DAILY,
};

enum RRuleWeekdays {
	Sunday = 0,
	Monday = 1,
	Tuesday = 2,
	Wednesday = 3,
	Thursday = 4,
	Friday = 5,
	Saturday = 6,
}

const RRuleWeekdaysToICalWeekday: Record<RRuleWeekdays, ICalWeekday> = {
	[RRuleWeekdays.Sunday]: ICalWeekday.SU,
	[RRuleWeekdays.Monday]: ICalWeekday.MO,
	[RRuleWeekdays.Tuesday]: ICalWeekday.TU,
	[RRuleWeekdays.Wednesday]: ICalWeekday.WE,
	[RRuleWeekdays.Thursday]: ICalWeekday.TH,
	[RRuleWeekdays.Friday]: ICalWeekday.FR,
	[RRuleWeekdays.Saturday]: ICalWeekday.SA,
};

type RRule = {
	start: string;
	end: string | null;
	frequency: RRuleFrequencies;
	interval: number | null;
	by_weekday: RRuleWeekdays[] | null;
	by_n_weekday: {n: number; day: RRuleWeekdays}[] | null;
	by_month: number[] | null;
	by_month_day: number[] | null;
	by_year_day: number[] | null;
	count: number | null;
};

type GuildScheduledEventException = {
	event_id: string;
	event_exception_id: string;
	scheduled_start_time: string;
	scheduled_end_time: string | null;
	is_canceled: boolean;
};

type APIGuildScheduledEventExtended = APIGuildScheduledEvent & {
	recurrence_rule: RRule | null;
	guild_scheduled_event_exceptions: GuildScheduledEventException[];
};

export default {
	async fetch(_request, env) {
		const events = await env.KV.get<ICalCalendarData>('events', 'json');
		if (!events) {
			return new Response('No events found', {status: 404});
		}
		const calendar = new ICalCalendar(events);
		return new Response(calendar.toString(), {
			headers: {
				'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=300, stale-if-error=300',
				'Content-Disposition': 'attachment; filename="events.ics"',
				'Content-Type': 'text/calendar; charset=utf-8',
			},
		});
	},

	async scheduled(_event, env) {
		const response = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/scheduled-events`, {
			headers: {Authorization: `Bot ${env.DISCORD_TOKEN}`},
		});
		const events: APIGuildScheduledEventExtended[] = await response.json();
		const calendar = new ICalCalendar();
		for (const event of events) {
			const eventMetadata = event.entity_metadata;
			const isLocationUrl =
				eventMetadata?.location?.startsWith('http://') || eventMetadata?.location?.startsWith('https://');
			calendar.createEvent({
				id: event.id,
				start: event.scheduled_start_time,
				end: event.scheduled_end_time,
				repeating: event.recurrence_rule
					? mapRecurrenceRuleToICal(event.recurrence_rule, event.guild_scheduled_event_exceptions)
					: null,
				summary: event.name,
				location: isLocationUrl ? null : eventMetadata?.location,
				description: event.description,
				organizer: event.creator ? {name: event.creator.username} : null,
				status: event.status === GuildScheduledEventStatus.Canceled ? ICalEventStatus.CANCELLED : undefined,
				url: isLocationUrl ? eventMetadata?.location : null,
				created: new Date(Number(event.id) / 4194304 + 1420070400000),
			});
		}
		await env.KV.put('events', JSON.stringify(calendar.toJSON()), {
			expirationTtl: 300,
		});
	},
} satisfies ExportedHandler<Env>;

function mapRecurrenceRuleToICal(rule: RRule, exceptions: GuildScheduledEventException[]): ICalRepeatingOptions {
	return {
		freq: RRuleFrequenciesToICalEventRepeatingFreq[rule.frequency],
		interval: rule.interval ?? undefined,
		until: rule.end ?? undefined,
		byDay: rule.by_weekday?.map((weekday) => RRuleWeekdaysToICalWeekday[weekday]),
		byMonth: rule.by_month ?? undefined,
		byMonthDay: rule.by_month_day ?? undefined,
		bySetPos: rule.by_year_day ?? undefined,
		count: rule.count ?? undefined,
		exclude: exceptions.filter((exception) => exception.is_canceled).map((exception) => exception.scheduled_start_time),
		startOfWeek: ICalWeekday.SU,
	};
}
