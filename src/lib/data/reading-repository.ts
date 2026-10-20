import { readingMutationResultSchema } from '../contracts/readings';
import type {
	AddCompletedReadingInput,
	FinishReadingInput,
	MarkDnfInput,
	RecordProgressInput,
	StartReadingInput
} from '../contracts/rpc';
import type { ReadingRepository } from './repositories';
import type { RpcTransport } from './rpc-client';
import { callRpc } from './rpc-client';
import { RPC } from './rpc-names';

/**
 * Letture: start/pause/resume, eventi di avanzamento (idempotenti sull'eventId),
 * chiusura (finish / DNF) e letture storiche. Le transizioni di stato sono
 * regole del database: qui si traducono solo argomenti e risposta.
 */
export class RpcReadingRepository implements ReadingRepository {
	constructor(private readonly transport: RpcTransport) {}

	start(input: StartReadingInput) {
		return callRpc(
			this.transport,
			RPC.startReading,
			{
				p_book_id: input.bookId,
				p_started_at: input.startedAt ?? null,
				p_start_page: input.startPage ?? 0
			},
			readingMutationResultSchema
		);
	}

	pause(readingId: string) {
		return callRpc(
			this.transport,
			RPC.pauseReading,
			{ p_reading_id: readingId },
			readingMutationResultSchema
		);
	}

	resume(readingId: string) {
		return callRpc(
			this.transport,
			RPC.resumeReading,
			{ p_reading_id: readingId },
			readingMutationResultSchema
		);
	}

	recordProgress(input: RecordProgressInput) {
		return this.event(RPC.recordProgress, input);
	}

	correctProgress(input: RecordProgressInput) {
		return this.event(RPC.correctProgress, input);
	}

	finish(input: FinishReadingInput) {
		return this.event(RPC.finishReading, input);
	}

	markDnf(input: MarkDnfInput) {
		return this.event(RPC.markDnf, input);
	}

	addCompletedReading(input: AddCompletedReadingInput) {
		return callRpc(
			this.transport,
			RPC.addCompletedReading,
			{
				p_book_id: input.bookId,
				p_started_at: input.startedAt,
				p_finished_at: input.finishedAt,
				p_final_page: input.finalPage,
				p_start_page: input.startPage ?? 0
			},
			readingMutationResultSchema
		);
	}

	private event(
		name:
			| typeof RPC.recordProgress
			| typeof RPC.correctProgress
			| typeof RPC.finishReading
			| typeof RPC.markDnf,
		input: RecordProgressInput
	) {
		return callRpc(
			this.transport,
			name,
			{
				p_event_id: input.eventId,
				p_reading_id: input.readingId,
				p_page: input.page,
				p_occurred_at: input.occurredAt ?? null,
				p_local_date: input.localDate ?? null
			},
			readingMutationResultSchema
		);
	}
}
